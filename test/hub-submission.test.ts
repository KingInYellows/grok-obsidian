import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { InputError } from "../src/errors.js";
import { SubmissionStore } from "../src/storage.js";
import { createTestFixture } from "./helpers.js";

const prefix = "<!-- intelligence-hub:submission:v1 -->\n```json\n";
const key = "daily-20261103T132100Z-synthetic";
const payload = { schema_version: "1", run_id: key, report_markdown: "SYNTHETIC research: café 😀" };
const frame = (json: string) => prefix + json + "\n```";
const input = (body = frame(JSON.stringify(payload))) => ({
  title: "SYNTHETIC hub report", topic: "intelligence-hub-v1", idempotency_key: key, body_markdown: body,
});
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

const invalid: [string, string][] = [
  ["opening-only", prefix], ["empty-json", frame("")], ["malformed-json", frame('{"secret":')],
  ["not-object", frame("[]")], ["null", frame("null")], ["empty-object", frame("{}")],
  ["trailing-lf", input().body_markdown + "\n"], ["prefix-noise", "noise" + input().body_markdown],
  ["wrong-version", frame(JSON.stringify({ ...payload, schema_version: "2" }))],
  ["missing-report", frame(JSON.stringify({ schema_version: "1", run_id: key }))],
  ["blank-report", frame(JSON.stringify({ ...payload, report_markdown: " \n\t" }))],
  ["nonstring-report", frame(JSON.stringify({ ...payload, report_markdown: {} }))],
  ["mismatched-key", frame(JSON.stringify({ ...payload, run_id: key + "x" }))],
  ["duplicate-key", frame('{"schema_version":"1","schema_version":"1","run_id":"' + key + '","report_markdown":"secret"}')],
  ["escaped-duplicate", frame('{"schema_version":"1","run_id":"' + key + '","report_markdown":"secret","nested":{"a":1,"\\u0061":2}}')],
  ["nonfinite-number", frame(JSON.stringify(payload).slice(0, -1) + ',"nested":[1e999]}')],
  ["escaped-high-surrogate", frame(JSON.stringify(payload).slice(0, -1) + ',"nested":"\\ud800"}')],
  ["escaped-low-surrogate-key", frame(JSON.stringify(payload).slice(0, -1) + ',"\\udfff":1}')],
  ["depth-33", frame(JSON.stringify(payload).slice(0, -1) + ',"nested":' + '['.repeat(32) + '0' + ']'.repeat(32) + '}')],
  ["utf16-size", frame(JSON.stringify({ ...payload, report_markdown: "x".repeat(50000) }))],
];
for (const [label, body] of invalid) {
  test(`hub guard rejects ${label} before any publication`, async () => {
    const f = await createTestFixture();
    let checkpoints = 0;
    try {
      const store = new SubmissionStore(f.config, { checkpoint: async () => { checkpoints += 1; } });
      await store.initialize();
      await assert.rejects(store.submit("synthetic-owner", input(body)), error => {
        assert.ok(error instanceof InputError);
        assert.equal(error.message.includes("secret"), false);
        assert.equal(error.message.includes(key), false);
        return true;
      });
      assert.equal(checkpoints, 0);
      for (const dir of [f.inboxDir, ...["originals", "pending", "committed"].map(n => path.join(f.auditDir, n))]) {
        assert.deepEqual(await readdir(dir), []);
      }
      assert.deepEqual((await store.list("synthetic-owner", 20)).submissions, []);
    } finally { await f.cleanup(); }
  });
}

test("valid hub keeps exact bytes, digest, restart retry and conflict semantics", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config); await store.initialize();
    // Nested arrays/objects and escaped punctuation exercise strict decoding without rewriting.
    const body = frame(JSON.stringify({ ...payload, extra: [{ a: "\\\"{}[]", nested: [true, false, null, -1.2e30] }] }, null, 2));
    const request = input(body);
    const receipt = await store.submit("synthetic-owner", request);
    assert.equal(receipt.content_sha256, hash(body));
    const original = await readFile(path.join(f.auditDir, "originals", receipt.note_id + ".md"), "utf8");
    assert.equal(original.split("\n## Submitted research\n\n")[1], body + "\n");
    const restarted = new SubmissionStore(f.config); await restarted.initialize();
    assert.deepEqual(await restarted.submit("synthetic-owner", request), receipt);
    await assert.rejects(restarted.submit("synthetic-owner", { ...request, body_markdown: prefix }), /idempotency key/);
    assert.equal((await readdir(path.join(f.auditDir, "originals"))).length, 1);
  } finally { await f.cleanup(); }
});

test("non-hub bodies remain general research and historical malformed hub retries survive", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config); await store.initialize();
    const legacyInput = { ...input(prefix), topic: "synthetic-other" };
    const receipt = await store.submit("synthetic-owner", legacyInput);
    // Seed a synthetic pre-guard committed hub receipt, preserving its original bytes/hash.
    const recordPath = path.join(f.auditDir, "committed", receipt.note_id + ".json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    const originalPath = path.join(f.auditDir, "originals", receipt.note_id + ".md");
    const original = (await readFile(originalPath, "utf8")).replace('topic: "synthetic-other"', 'topic: "intelligence-hub-v1"');
    record.topic = "intelligence-hub-v1";
    record.original_sha256 = hash(original);
    record.request_sha256 = hash(JSON.stringify({ title: legacyInput.title, body_markdown: prefix, source_urls: [], topic: record.topic }));
    await writeFile(originalPath, original);
    await writeFile(recordPath, JSON.stringify(record));
    const restarted = new SubmissionStore(f.config); await restarted.initialize();
    assert.deepEqual(await restarted.submit("synthetic-owner", input(prefix)), receipt);
    await assert.rejects(restarted.submit("synthetic-owner", input()), /idempotency key/);
    assert.equal((await readdir(path.join(f.auditDir, "committed"))).length, 1);
  } finally { await f.cleanup(); }
});

test("depth 32 is accepted but depth 33 is rejected", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config); await store.initialize();
    const body = frame(JSON.stringify(payload).slice(0, -1) + ',"nested":' + '['.repeat(31) + '{"bad":1}' + ']'.repeat(31) + '}');
    // root object + 31 arrays + object exceeds 32; scalar at same position is valid.
    await assert.rejects(store.submit("synthetic-owner", input(body)), InputError);
    const valid = body.replace('{"bad":1}', '0');
    assert.equal((await store.submit("synthetic-owner", input(valid))).content_sha256, hash(valid));
  } finally { await f.cleanup(); }
});

for (const invalidKey of ["short", "a".repeat(101), "daily.20261103T132100Z"]) {
  test(`hub run ID bounds reject ${invalidKey.length}-character invalid key`, async () => {
    const f = await createTestFixture();
    try {
      const store = new SubmissionStore(f.config); await store.initialize();
      const request = { ...input(frame(JSON.stringify({ ...payload, run_id: invalidKey }))), idempotency_key: invalidKey };
      await assert.rejects(store.submit("synthetic-owner", request), InputError);
      assert.deepEqual(await readdir(path.join(f.auditDir, "originals")), []);
    } finally { await f.cleanup(); }
  });
}

test("hub respects UTF-8 and rendered-note limits without publication", async () => {
  for (const overrides of [{ GROK_MCP_MAX_RESEARCH_BYTES: "1024" }, { GROK_MCP_MAX_NOTE_BYTES: "8192" }]) {
    const f = await createTestFixture(overrides);
    try {
      const store = new SubmissionStore(f.config); await store.initialize();
      const body = frame(JSON.stringify({ ...payload, report_markdown: "é".repeat(overrides.GROK_MCP_MAX_NOTE_BYTES ? 4000 : 600) }));
      await assert.rejects(store.submit("synthetic-owner", input(body)), InputError);
      for (const n of ["originals", "pending", "committed"]) assert.deepEqual(await readdir(path.join(f.auditDir, n)), []);
    } finally { await f.cleanup(); }
  }
});

test("JSON escaped valid Unicode pairs and distinct keys preserve their bytes", async () => {
  const f = await createTestFixture();
  try {
    const store = new SubmissionStore(f.config); await store.initialize();
    const body = frame(JSON.stringify(payload).slice(0, -1) + ',"nested":{"a":1,"á":2,"pair":"\\ud83d\\ude00"}}');
    assert.equal((await store.submit("synthetic-owner", input(body))).content_sha256, hash(body));
  } finally { await f.cleanup(); }
});
