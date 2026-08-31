import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { link, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { InputError, StorageUnavailableError } from "../src/errors.js";
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


test("candidate group-read mode survives umask without exposing audit or changing replay", {
  skip: process.platform === "win32",
}, async () => {
  const script = `
    import { lstat, readdir } from "node:fs/promises";
    import path from "node:path";
    import { createTestFixture } from "./test/helpers.ts";
    import { SubmissionStore } from "./src/storage.ts";
    process.umask(0o077);
    const results = [];
    for (const mode of [undefined, "0600", "0640"]) {
      const fixture = await createTestFixture(mode ? { GROK_MCP_NOTE_FILE_MODE: mode } : {});
      try {
        const store = new SubmissionStore(fixture.config);
        await store.initialize();
        const input = { title: "Permission fixture", body_markdown: "Synthetic only.", idempotency_key: "permission_fixture_20260830" };
        const receipt = await store.submit("fixture-subject", input);
        const restarted = new SubmissionStore(fixture.config);
        await restarted.initialize();
        const replay = await restarted.submit("fixture-subject", input);
        const files = await readdir(fixture.inboxDir);
        const note = await lstat(path.join(fixture.inboxDir, files[0]));
        const auditDir = path.join(fixture.auditDir, "committed");
        const audit = await lstat(path.join(auditDir, (await readdir(auditDir))[0]));
        results.push({ noteMode: note.mode & 0o777, auditMode: audit.mode & 0o777,
          auditDirMode: (await lstat(auditDir)).mode & 0o777, links: note.nlink,
          files: files.length, partials: files.filter(n => n.endsWith(".partial")).length,
          sameReceipt: JSON.stringify(receipt) === JSON.stringify(replay) });
      } finally { await fixture.cleanup(); }
    }
    console.log(JSON.stringify(results));
  `;
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script]);
  assert.deepEqual(JSON.parse(stdout), [0o600, 0o600, 0o640].map(noteMode => ({
    noteMode, auditMode: 0o600, auditDirMode: 0o700, links: 1,
    files: 1, partials: 0, sameReceipt: true,
  })));
});

test("low or unreadable storage fails closed for either filesystem without creating files", async () => {
  const fixture = await createTestFixture({ GROK_MCP_MIN_FREE_BYTES: "4096" });
  try {
    for (const failingPath of [fixture.inboxDir, fixture.auditDir]) {
      for (const unavailable of ["low", "error"] as const) {
        const store = new SubmissionStore(fixture.config, {
          availableBytes: async directory => {
            if (directory !== failingPath) return 4096n;
            if (unavailable === "error") throw new Error("private filesystem path");
            return 4095n;
          },
        });
        await store.initialize();
        await assert.rejects(store.submit("subject-a", baseInput()), error => {
          assert.ok(error instanceof StorageUnavailableError);
          assert.equal(error.message.includes("private"), false);
          return true;
        });
        for (const directory of [fixture.inboxDir, path.join(fixture.auditDir, "pending"), path.join(fixture.auditDir, "committed")]) {
          assert.deepEqual(await readdir(directory), []);
        }
      }
    }
  } finally { await fixture.cleanup(); }
});

test("reserve checks run per serialized new submission while low-space replay survives restart", async () => {
  const fixture = await createTestFixture({ GROK_MCP_MIN_FREE_BYTES: "4096" });
  let checks = 0;
  try {
    const store = new SubmissionStore(fixture.config, {
      availableBytes: async () => ++checks <= 2 ? 4096n : 0n,
    });
    await store.initialize();
    const outcomes = await Promise.allSettled([
      store.submit("subject-a", baseInput()),
      store.submit("subject-a", baseInput({ idempotency_key: "different_key_1234567890" })),
    ]);
    assert.equal(outcomes[0]!.status, "fulfilled");
    assert.equal(outcomes[1]!.status, "rejected");
    if (outcomes[0]!.status !== "fulfilled") throw new Error("first submission failed");
    const beforeReplay = checks;
    assert.deepEqual(await store.submit("subject-a", baseInput()), outcomes[0]!.value);
    assert.equal(checks, beforeReplay);
    const restarted = new SubmissionStore(fixture.config, { availableBytes: async () => { throw new Error("statfs unavailable"); } });
    await restarted.initialize();
    assert.deepEqual(await restarted.submit("subject-a", baseInput()), outcomes[0]!.value);
    assert.equal((await readdir(fixture.inboxDir)).length, 1);
    await assert.rejects(restarted.submit("subject-a", baseInput({ title: "changed" })), InputError);
  } finally { await fixture.cleanup(); }
});

test("exclusive temporary-file collisions never remove existing files", async () => {
  const fixture = await createTestFixture();
  try {
    const collidingName = "grn_11111111111141118111111111111111.partial";
    await writeFile(path.join(fixture.inboxDir, collidingName), "existing collision");
    const uuids = [firstUuid, secondUuid];
    const store = new SubmissionStore(fixture.config, {
      randomUuid: () => uuids.shift() ?? secondUuid,
      now: () => fixedDate,
    });
    await store.initialize();
    await store.submit("subject-a", baseInput());
    assert.equal(await readFile(path.join(fixture.inboxDir, collidingName), "utf8"), "existing collision");
    assert.deepEqual(await readdir(path.join(fixture.auditDir, "pending")), []);
  } finally { await fixture.cleanup(); }
});

test("OS write-size failure cleans partially-created note and audit files", {
  skip: process.platform !== "linux",
}, async () => {
  const script = `
    import assert from "node:assert/strict";
    import { readdir } from "node:fs/promises";
    import path from "node:path";
    import { createTestFixture } from "./test/helpers.ts";
    import { SubmissionStore } from "./src/storage.ts";
    const fixture = await createTestFixture({ GROK_MCP_NOTE_FILE_MODE: "0640" });
    try {
      const store = new SubmissionStore(fixture.config, { availableBytes: async () => 2n ** 40n });
      await store.initialize();
      await assert.rejects(store.submit("fixture-subject", {
        title: "Write failure fixture", body_markdown: "x".repeat(10000),
        idempotency_key: "write_failure_fixture_20260830",
      }), error => error.code === "EFBIG");
      for (const dir of [fixture.inboxDir, path.join(fixture.auditDir, "pending"), path.join(fixture.auditDir, "committed")]) {
        assert.deepEqual(await readdir(dir), []);
      }
      console.log("write-failure-cleanup-passed");
    } finally { await fixture.cleanup(); }
  `;
  const launcher = "import os,resource,signal,sys; resource.setrlimit(resource.RLIMIT_FSIZE,(4096,4096)); signal.signal(signal.SIGXFSZ,signal.SIG_IGN); os.execv(sys.argv[1],sys.argv[1:])";
  const { stdout } = await promisify(execFile)("python3", ["-c", launcher, process.execPath,
    "--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, TSX_DISABLE_CACHE: "1" }, timeout: 30000,
    });
  assert.equal(stdout.trim(), "write-failure-cleanup-passed");
});
