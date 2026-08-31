import assert from "node:assert/strict";
import { mkdir, rm, symlink } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { loadConfig } from "../src/config.js";
import { ConfigurationError } from "../src/errors.js";
import { createTestFixture } from "./helpers.js";

test("configuration rejects an inbox outside the staging root", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "grok-mcp-config-"));
  try {
    const root = path.join(base, "root");
    const inbox = path.join(base, "outside-inbox");
    const audit = path.join(root, "audit");
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(inbox, { recursive: true }),
      mkdir(audit, { recursive: true }),
    ]);
    await assert.rejects(
      loadConfig({
        GROK_MCP_STAGING_ROOT: root,
        GROK_MCP_INBOX_DIR: inbox,
        GROK_MCP_AUDIT_DIR: audit,
        GROK_MCP_AUTH_MODE: "local-development",
      }),
      ConfigurationError,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("configuration rejects a symlink or reparse-point inbox", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "grok-mcp-config-"));
  try {
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    const inbox = path.join(root, "inbox-link");
    const audit = path.join(root, "audit");
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(audit, { recursive: true }),
    ]);
    await symlink(outside, inbox, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      loadConfig({
        GROK_MCP_STAGING_ROOT: root,
        GROK_MCP_INBOX_DIR: inbox,
        GROK_MCP_AUDIT_DIR: audit,
        GROK_MCP_AUTH_MODE: "local-development",
      }),
      ConfigurationError,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("configuration fails closed unless local development is explicit or Access is complete", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "grok-mcp-config-"));
  try {
    const root = path.join(base, "root");
    const inbox = path.join(root, "inbox");
    const audit = path.join(root, "audit");
    await Promise.all([mkdir(inbox, { recursive: true }), mkdir(audit, { recursive: true })]);
    await assert.rejects(
      loadConfig({
        GROK_MCP_STAGING_ROOT: root,
        GROK_MCP_INBOX_DIR: inbox,
        GROK_MCP_AUDIT_DIR: audit,
      }),
      /cloudflare-access mode requires/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("configuration rejects a dot-prefixed hidden inbox", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "grok-mcp-config-"));
  try {
    const root = path.join(base, "root");
    const inbox = path.join(root, ".hidden-inbox");
    const audit = path.join(root, "audit");
    await Promise.all([mkdir(inbox, { recursive: true }), mkdir(audit, { recursive: true })]);
    await assert.rejects(
      loadConfig({
        GROK_MCP_STAGING_ROOT: root,
        GROK_MCP_INBOX_DIR: inbox,
        GROK_MCP_AUDIT_DIR: audit,
        GROK_MCP_AUTH_MODE: "local-development",
      }),
      /dot-prefixed/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});


test("candidate file mode is restricted to owner-only or group-readable", async () => {
  const fixture = await createTestFixture();
  try {
    const env = {
      GROK_MCP_STAGING_ROOT: fixture.rootDir,
      GROK_MCP_INBOX_DIR: fixture.inboxDir,
      GROK_MCP_AUDIT_DIR: fixture.auditDir,
      GROK_MCP_AUTH_MODE: "local-development",
    };
    for (const invalid of ["", "600", "640", "0644", "0660", "0666", "0777"]) {
      await assert.rejects(loadConfig({ ...env, GROK_MCP_NOTE_FILE_MODE: invalid }));
    }
  } finally {
    await fixture.cleanup();
  }
});

test("storage reserve defaults to 1 GiB and rejects invalid byte counts", async () => {
  const fixture = await createTestFixture();
  try {
    assert.equal(fixture.config.minFreeBytes, 1_073_741_824);
    const env = {
      GROK_MCP_STAGING_ROOT: fixture.rootDir,
      GROK_MCP_INBOX_DIR: fixture.inboxDir,
      GROK_MCP_AUDIT_DIR: fixture.auditDir,
      GROK_MCP_AUTH_MODE: "local-development",
    };
    for (const invalid of ["", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
      await assert.rejects(loadConfig({ ...env, GROK_MCP_MIN_FREE_BYTES: invalid }), /MIN_FREE_BYTES/);
    }
    assert.equal((await loadConfig({ ...env, GROK_MCP_MIN_FREE_BYTES: "4096" })).minFreeBytes, 4096);
  } finally { await fixture.cleanup(); }
});
