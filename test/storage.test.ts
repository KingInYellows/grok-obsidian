import assert from "node:assert/strict";
import { link, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { InputError } from "../src/errors.js";
import { SubmissionStore } from "../src/storage.js";
import { createTestFixture } from "./helpers.js";

const firstUuid = "11111111-1111-4111-8111-111111111111";
const secondUuid = "22222222-2222-4222-8222-222222222222";
const fixedDate = new Date("2026-08-29T12:34:56.789Z");

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Research title",
    body_markdown: "Untrusted research body.",
    source_urls: ["https://example.com/source"],
    topic: "example topic",
    idempotency_key: "idem_1234567890123456",
    ...overrides,
  };
}

test("submission creates one server-named note and is idempotent under concurrency", async () => {
  const fixture = await createTestFixture();
  try {
    const store = new SubmissionStore(fixture.config, {
      randomUuid: () => firstUuid,
      now: () => fixedDate,
    });
    await store.initialize();
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => store.submit("subject-a", baseInput())),
    );
    assert.equal(new Set(receipts.map((receipt) => receipt.note_id)).size, 1);
    const files = (await readdir(fixture.inboxDir)).filter((name) => name.endsWith(".md"));
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^20260829T123456789Z--research-title--[a-f0-9]{12}\.md$/u);
    const note = await readFile(path.join(fixture.inboxDir, files[0]!), "utf8");
    assert.match(note, /producer: grok-research-mcp/u);
    assert.match(note, /> \[!warning\] Untrusted external research/u);
    assert.match(note, /https:\/\/example\.com\/source/u);
    assert.match(note, /Untrusted research body\./u);
    assert.equal((await lstat(path.join(fixture.inboxDir, files[0]!))).nlink, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("audit hardlinks are rejected on restart", async () => {
  const fixture = await createTestFixture();
  try {
    const store = new SubmissionStore(fixture.config);
    await store.initialize();
    await store.submit("subject-a", baseInput());
    const committedDir = path.join(fixture.auditDir, "committed");
    const [recordName] = await readdir(committedDir);
    assert.ok(recordName);
    await link(
      path.join(committedDir, recordName),
      path.join(fixture.auditDir, "external-hardlink.json"),
    );
    await assert.rejects(new SubmissionStore(fixture.config).initialize(), /regular-file safety/);
  } finally {
    await fixture.cleanup();
  }
});

test("a generated filename collision preserves the existing file and retries", async () => {
  const fixture = await createTestFixture();
  try {
    const collidingName = "20260829T123456789Z--research-title--111111111111.md";
    await writeFile(path.join(fixture.inboxDir, collidingName), "existing", "utf8");
    const uuids = [firstUuid, secondUuid];
    const store = new SubmissionStore(fixture.config, {
      randomUuid: () => uuids.shift() ?? secondUuid,
      now: () => fixedDate,
    });
    await store.initialize();
    const receipt = await store.submit("subject-a", baseInput());
    assert.equal(receipt.note_id, "grn_22222222222242228222222222222222");
    assert.equal(
      await readFile(path.join(fixture.inboxDir, collidingName), "utf8"),
      "existing",
    );
    const markdownFiles = (await readdir(fixture.inboxDir)).filter((name) => name.endsWith(".md"));
    assert.equal(markdownFiles.length, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("oversize UTF-8 bodies and changed-content idempotency replays fail", async () => {
  const fixture = await createTestFixture({ GROK_MCP_MAX_RESEARCH_BYTES: "1024" });
  try {
    const store = new SubmissionStore(fixture.config);
    await store.initialize();
    await assert.rejects(
      store.submit("subject-a", baseInput({ body_markdown: "é".repeat(600) })),
      InputError,
    );
    await store.submit("subject-a", baseInput());
    await assert.rejects(
      store.submit("subject-a", baseInput({ title: "Different title" })),
      /idempotency key was already used for different content/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("metadata listing never returns body, URLs, paths, owner, or idempotency keys", async () => {
  const fixture = await createTestFixture();
  try {
    const store = new SubmissionStore(fixture.config);
    await store.initialize();
    await store.submit("subject-a", baseInput());
    await store.submit(
      "subject-b",
      baseInput({ idempotency_key: "idem_abcdef1234567890", body_markdown: "Other owner" }),
    );
    const page = await store.list("subject-a", 20);
    assert.equal(page.submissions.length, 1);
    const serialized = JSON.stringify(page);
    for (const forbidden of [
      "Untrusted research body",
      "https://example.com/source",
      fixture.inboxDir,
      "subject-a",
      "idem_1234567890123456",
      "filename",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `listing leaked ${forbidden}`);
    }
  } finally {
    await fixture.cleanup();
  }
});
