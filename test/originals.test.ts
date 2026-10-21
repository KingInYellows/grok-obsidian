import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { readFile, readdir, unlink, writeFile, link, symlink, lstat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createTestFixture } from "./helpers.js";
import { SubmissionStore } from "../src/storage.js";

const input = { title: "Synthetic original", body_markdown: "Original body.\n\nWith Unicode: é.", idempotency_key: "original_fixture_12345" };

test("accepted original survives curator deletion and restart without changing receipt", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config);
    await store.initialize();
    const receipt = await store.submit("synthetic-owner", input);
    const name = (await readdir(f.inboxDir))[0]!;
    const published = await readFile(path.join(f.inboxDir, name));
    const original = path.join(f.auditDir, "originals", receipt.note_id + ".md");
    assert.deepEqual(await readFile(original), published);
    assert.equal((await lstat(original)).mode & 0o777, 0o600);
    assert.equal((await lstat(original)).nlink, 1);
    await unlink(path.join(f.inboxDir, name));
    const restarted = new SubmissionStore(f.config);
    await restarted.initialize();
    assert.deepEqual(await restarted.submit("synthetic-owner", input), receipt);
    assert.deepEqual(await readFile(original), published);
    assert.deepEqual(await readdir(f.inboxDir), []);
  } finally { await f.cleanup(); }
});

for (const stage of ["pending-temp", "pending-linked", "pending", "original-temp", "original-linked", "original", "inbox-linked", "inbox", "committed"]) {
  test(`SIGKILL at ${stage} recovers with one accepted durable original`, async () => {
    const f = await createTestFixture();
    try {
      const child = `
        import { SubmissionStore } from "./src/storage.ts";
        const store = new SubmissionStore(JSON.parse(process.argv[1]), {
          randomUuid: () => "11111111-1111-4111-8111-111111111111",
          checkpoint: async stage => { if (stage === process.argv[2]) process.kill(process.pid, "SIGKILL"); },
        });
        await store.initialize();
        await store.submit("synthetic-owner", JSON.parse(process.argv[3]));
        throw new Error("kill checkpoint did not run");
      `;
      await assert.rejects(promisify(execFile)(process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", child, JSON.stringify(f.config), stage, JSON.stringify(input)],
        { timeout: 10000 }), (error: any) => error.signal === "SIGKILL");
      // Simulate curator loss of all synced artifacts before restart/capture.
      for (const name of await readdir(f.inboxDir)) await unlink(path.join(f.inboxDir, name));
      const restarted = new SubmissionStore(f.config);
      await restarted.initialize();
      const receipt = await restarted.submit("synthetic-owner", input);
      assert.deepEqual(await restarted.submit("synthetic-owner", input), receipt);
      const originals = await readdir(path.join(f.auditDir, "originals"));
      assert.deepEqual(originals, [receipt.note_id + ".md"]);
      assert.equal((await lstat(path.join(f.auditDir, "originals", originals[0]!))).nlink, 1);
      assert.equal((await readdir(path.join(f.auditDir, "committed"))).length, 1);
      assert.deepEqual(await readdir(path.join(f.auditDir, "pending")), []);
      if (!["pending-temp", "pending-linked", "pending", "original-temp"].includes(stage)) {
        assert.equal(receipt.note_id, "grn_11111111111141118111111111111111");
        assert.deepEqual(await readdir(f.inboxDir), []);
      }
    } finally { await f.cleanup(); }
  });
}

for (const mutation of ["delete", "tamper", "hardlink", "symlink"]) {
  test(`private original ${mutation} fails closed on replay and restart`, async () => {
    const f = await createTestFixture();
    try {
      const store = new SubmissionStore(f.config);
      await store.initialize();
      const receipt = await store.submit("synthetic-owner", input);
      const original = path.join(f.auditDir, "originals", receipt.note_id + ".md");
      if (mutation === "delete") await unlink(original);
      if (mutation === "tamper") await writeFile(original, "modified");
      if (mutation === "hardlink") await link(original, path.join(f.baseDir, "linked"));
      if (mutation === "symlink") { await unlink(original); await symlink(path.join(f.inboxDir, (await readdir(f.inboxDir))[0]!), original); }
      await assert.rejects(store.submit("synthetic-owner", input));
      await assert.rejects(new SubmissionStore(f.config).initialize());
    } finally { await f.cleanup(); }
  });
}

for (const quota of [{ GROK_MCP_MAX_ORIGINALS: "1" }, { GROK_MCP_MAX_ORIGINAL_BYTES: "1" }]) {
  test(`private storage quota ${Object.keys(quota)[0]} pauses without deleting originals`, async () => {
    const f = await createTestFixture(quota);
    try {
      const store = new SubmissionStore(f.config);
      await store.initialize();
      if (quota.GROK_MCP_MAX_ORIGINALS) {
        const receipt = await store.submit("synthetic-owner", input);
        await assert.rejects(store.submit("synthetic-owner", { ...input, idempotency_key: "another_original_123456" }), /original storage is full/);
        assert.deepEqual(await store.submit("synthetic-owner", input), receipt);
        assert.equal((await readdir(path.join(f.auditDir, "originals"))).length, 1);
      } else {
        await assert.rejects(store.submit("synthetic-owner", input), /original storage is full/);
        assert.deepEqual(await readdir(path.join(f.auditDir, "originals")), []);
      }
    } finally { await f.cleanup(); }
  });
}

test("failure after private preservation requires recovery and never deletes evidence", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config, { checkpoint: async stage => { if (stage === "original") throw new Error("synthetic failure"); } });
    await store.initialize();
    await assert.rejects(store.submit("synthetic-owner", input), /synthetic failure/);
    await assert.rejects(store.submit("synthetic-owner", input), /requires restart/);
    const restarted = new SubmissionStore(f.config);
    await restarted.initialize();
    await restarted.submit("synthetic-owner", input);
    assert.equal((await readdir(path.join(f.auditDir, "originals"))).length, 1);
    assert.equal((await readdir(path.join(f.auditDir, "committed"))).length, 1);
  } finally { await f.cleanup(); }
});

test("legacy committed receipts remain legacy; pending legacy needs explicit review", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config);
    await store.initialize();
    const receipt = await store.submit("synthetic-owner", input);
    const recordPath = path.join(f.auditDir, "committed", receipt.note_id + ".json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    delete record.original_sha256;
    await writeFile(recordPath, JSON.stringify(record));
    await unlink(path.join(f.auditDir, "originals", receipt.note_id + ".md"));
    const restarted = new SubmissionStore(f.config);
    await restarted.initialize();
    assert.deepEqual(await restarted.submit("synthetic-owner", input), receipt);
    assert.deepEqual(await readdir(path.join(f.auditDir, "originals")), []);
    await writeFile(path.join(f.auditDir, "pending", receipt.note_id + ".json"), JSON.stringify(record));
    await assert.rejects(new SubmissionStore(f.config).initialize(), /legacy transaction/);
  } finally { await f.cleanup(); }
});

for (const changed of [false, true]) {
  test(`pending/committed duplicate ${changed ? "conflict preserves" : "reconciles"} committed bytes`, async () => {
    const f = await createTestFixture();
    try {
      const store = new SubmissionStore(f.config);
      await store.initialize();
      const receipt = await store.submit("synthetic-owner", input);
      const committed = path.join(f.auditDir, "committed", receipt.note_id + ".json");
      const before = await readFile(committed);
      const record = JSON.parse(before.toString());
      if (changed) record.title = "Conflicting metadata";
      await writeFile(path.join(f.auditDir, "pending", receipt.note_id + ".json"), JSON.stringify(record));
      if (changed) await assert.rejects(new SubmissionStore(f.config).initialize(), /conflicts/);
      else await new SubmissionStore(f.config).initialize();
      assert.deepEqual(await readFile(committed), before);
    } finally { await f.cleanup(); }
  });
}

test("original creation failure cannot return a receipt or leave committed metadata", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config, { checkpoint: async stage => {
      if (stage === "pending") throw new Error("synthetic storage failure");
    }});
    await store.initialize();
    await assert.rejects(store.submit("synthetic-owner", input), /storage failure/);
    assert.deepEqual(await readdir(path.join(f.auditDir, "committed")), []);
    assert.deepEqual(await readdir(path.join(f.auditDir, "originals")), []);
  } finally { await f.cleanup(); }
});

test("private read mode survives restrictive umask and committed rename", async () => {
  const f = await createTestFixture({ GROK_MCP_PRIVATE_FILE_MODE: "0640" });
  const previous = process.umask(0o077);
  try {
    const store = new SubmissionStore(f.config, { checkpoint: async stage => {
      if (stage === "pending") {
        const names = await readdir(path.join(f.auditDir, "pending"));
        assert.equal((await lstat(path.join(f.auditDir, "pending", names[0]!))).mode & 0o777, 0o640);
      }
    }});
    await store.initialize();
    const receipt = await store.submit("synthetic-owner", input);
    for (const [directory, extension] of [["originals", ".md"], ["committed", ".json"]]) {
      assert.equal((await lstat(path.join(f.auditDir, directory!, receipt.note_id + extension))).mode & 0o777, 0o640);
    }
    const restarted = new SubmissionStore(f.config);
    await restarted.initialize();
    assert.deepEqual(await restarted.submit("synthetic-owner", input), receipt);
  } finally { process.umask(previous); await f.cleanup(); }
});
