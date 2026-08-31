import path from "node:path";
import { z } from "zod/v4";

import { ConfigurationError } from "./errors.js";
import {
  inspectExistingDirectory,
  isStrictlyContained,
  validateDirectoryBoundary,
} from "./path-safety.js";
import type { AppConfig, AuthMode } from "./types.js";

const HOST = "127.0.0.1" as const;

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError(`${label} must be true or false`);
}

function parseHosts(value: string | undefined, authMode: AuthMode): ReadonlySet<string> {
  const hosts = new Set(["127.0.0.1", "localhost"]);
  for (const rawHost of value?.split(",") ?? []) {
    const host = rawHost.trim().toLowerCase();
    if (!host) continue;
    if (host.includes("://") || host.includes("/") || host.includes("\\")) {
      throw new ConfigurationError("GROK_MCP_ALLOWED_HOSTS must contain hostnames only");
    }
    const parsed = new URL(`http://${host}`);
    hosts.add(parsed.hostname.toLowerCase());
  }
  if (authMode === "cloudflare-access" && hosts.size === 2) {
    throw new ConfigurationError(
      "GROK_MCP_ALLOWED_HOSTS must name the tunnel hostname in cloudflare-access mode",
    );
  }
  return hosts;
}

function parseOrigins(value: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const rawOrigin of value?.split(",") ?? []) {
    const trimmed = rawOrigin.trim();
    if (!trimmed) continue;
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.origin !== trimmed) {
      throw new ConfigurationError(
        "GROK_MCP_ALLOWED_ORIGINS entries must be exact HTTPS origins without paths",
      );
    }
    origins.add(url.origin);
  }
  return origins;
}

function parseTeamDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value ||
    !parsed.hostname.endsWith(".cloudflareaccess.com")
  ) {
    throw new ConfigurationError(
      "GROK_MCP_ACCESS_TEAM_DOMAIN must be an exact https://*.cloudflareaccess.com origin",
    );
  }
  return parsed.origin;
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppConfig> {
  const authMode = z
    .enum(["local-development", "cloudflare-access"])
    .parse(env.GROK_MCP_AUTH_MODE ?? "cloudflare-access");

  const rootInput = env.GROK_MCP_STAGING_ROOT;
  const inboxInput = env.GROK_MCP_INBOX_DIR;
  const auditInput = env.GROK_MCP_AUDIT_DIR;
  if (!rootInput || !inboxInput || !auditInput) {
    throw new ConfigurationError(
      "GROK_MCP_STAGING_ROOT, GROK_MCP_INBOX_DIR, and GROK_MCP_AUDIT_DIR are required",
    );
  }

  for (const [label, value] of [
    ["staging root", rootInput],
    ["inbox directory", inboxInput],
    ["audit directory", auditInput],
  ] as const) {
    if (!path.isAbsolute(value)) {
      throw new ConfigurationError(`${label} must be an absolute path`);
    }
  }

  const stagingRoot = await inspectExistingDirectory(rootInput, "staging root");
  const inboxDir = await inspectExistingDirectory(inboxInput, "inbox directory");
  const auditDir = await inspectExistingDirectory(auditInput, "audit directory");
  await validateDirectoryBoundary(stagingRoot, inboxDir, "inbox directory");
  await validateDirectoryBoundary(stagingRoot, auditDir, "audit directory");
  if (
    path.relative(inboxDir, auditDir) === "" ||
    isStrictlyContained(inboxDir, auditDir) ||
    isStrictlyContained(auditDir, inboxDir)
  ) {
    throw new ConfigurationError("inbox and audit directories cannot contain one another");
  }

  const noteFileMode = z.enum(["0600", "0640"]).parse(env.GROK_MCP_NOTE_FILE_MODE ?? "0600");

  const accessTeamDomain = parseTeamDomain(env.GROK_MCP_ACCESS_TEAM_DOMAIN);
  const accessAudience = env.GROK_MCP_ACCESS_AUD?.trim() || undefined;
  if (authMode === "cloudflare-access" && (!accessTeamDomain || !accessAudience)) {
    throw new ConfigurationError(
      "cloudflare-access mode requires GROK_MCP_ACCESS_TEAM_DOMAIN and GROK_MCP_ACCESS_AUD",
    );
  }

  return {
    host: HOST,
    port: parseInteger(env.GROK_MCP_PORT, 3100, 1, 65535, "GROK_MCP_PORT"),
    stagingRoot,
    inboxDir,
    auditDir,
    noteFileMode: noteFileMode === "0640" ? 0o640 : 0o600,
    authMode,
    ...(accessTeamDomain ? { accessTeamDomain } : {}),
    ...(accessAudience ? { accessAudience } : {}),
    allowedHosts: parseHosts(env.GROK_MCP_ALLOWED_HOSTS, authMode),
    allowedOrigins: parseOrigins(env.GROK_MCP_ALLOWED_ORIGINS),
    maxRequestBytes: parseInteger(
      env.GROK_MCP_MAX_REQUEST_BYTES,
      131_072,
      16_384,
      1_048_576,
      "GROK_MCP_MAX_REQUEST_BYTES",
    ),
    maxResearchBytes: parseInteger(
      env.GROK_MCP_MAX_RESEARCH_BYTES,
      50_000,
      1_024,
      50_000,
      "GROK_MCP_MAX_RESEARCH_BYTES",
    ),
    maxNoteBytes: parseInteger(
      env.GROK_MCP_MAX_NOTE_BYTES,
      65_536,
      8_192,
      131_072,
      "GROK_MCP_MAX_NOTE_BYTES",
    ),
    minFreeBytes: parseInteger(
      env.GROK_MCP_MIN_FREE_BYTES,
      1_073_741_824,
      1,
      Number.MAX_SAFE_INTEGER,
      "GROK_MCP_MIN_FREE_BYTES",
    ),
    requestsPerMinute: parseInteger(
      env.GROK_MCP_REQUESTS_PER_MINUTE,
      120,
      1,
      10_000,
      "GROK_MCP_REQUESTS_PER_MINUTE",
    ),
    enableListSubmissions: parseBoolean(
      env.GROK_MCP_ENABLE_LIST_SUBMISSIONS,
      true,
      "GROK_MCP_ENABLE_LIST_SUBMISSIONS",
    ),
  };
}
