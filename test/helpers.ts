import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadConfig } from "../src/config.js";
import type { AppConfig } from "../src/types.js";

export interface TestFixture {
  readonly baseDir: string;
  readonly rootDir: string;
  readonly inboxDir: string;
  readonly auditDir: string;
  readonly config: AppConfig;
  cleanup(): Promise<void>;
}

export async function createTestFixture(
  overrides: NodeJS.ProcessEnv = {},
): Promise<TestFixture> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "grok-obsidian-mcp-test-"));
  const rootDir = path.join(baseDir, "staging");
  const inboxDir = path.join(rootDir, "Grok Research Inbox");
  const auditDir = path.join(rootDir, "service-audit");
  await mkdir(inboxDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  const config = await loadConfig({
    GROK_MCP_STAGING_ROOT: rootDir,
    GROK_MCP_INBOX_DIR: inboxDir,
    GROK_MCP_AUDIT_DIR: auditDir,
    GROK_MCP_AUTH_MODE: "local-development",
    ...overrides,
  });
  return {
    baseDir,
    rootDir,
    inboxDir,
    auditDir,
    config,
    cleanup: () => rm(baseDir, { recursive: true, force: true }),
  };
}
