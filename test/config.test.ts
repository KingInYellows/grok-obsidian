import assert from "node:assert/strict";
import { mkdir, rm, symlink } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { loadConfig } from "../src/config.js";
import { ConfigurationError } from "../src/errors.js";

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
