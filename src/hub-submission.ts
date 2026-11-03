import { InputError } from "./errors.js";
import type { SubmissionInput } from "./types.js";

const prefix = "<!-- intelligence-hub:submission:v1 -->\n```json\n";
const suffix = "\n```";
const fail = (): never => { throw new InputError("hub submission is incomplete or invalid"); };

function validUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** JSON.parse establishes grammar; this bounded lexical pass checks what it loses:
 * duplicate (decoded) object keys, container depth and escaped malformed Unicode.
 * It never builds another object or transforms the original submission bytes.
 */
function checkTokens(raw: string): void {
  const containers: (Set<string> | null)[] = [];
  const stringToken = /"(?:\\[\s\S]|[^"\\])*"/y;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') {
      stringToken.lastIndex = i;
      const token = stringToken.exec(raw);
      if (!token) fail();
      const value = JSON.parse(token![0]) as string;
      if (!validUnicode(value)) fail();
      i = stringToken.lastIndex - 1;
      let next = i + 1;
      while (/\s/u.test(raw[next] ?? "") && next < raw.length) next += 1;
      if (raw[next] === ":") {
        const keys = containers[containers.length - 1];
        if (!keys || keys.has(value)) fail();
        keys!.add(value);
      }
    } else if (char === "{" || char === "[") {
      containers.push(char === "{" ? new Set<string>() : null);
      if (containers.length > 32) fail();
    } else if (char === "}" || char === "]") containers.pop();
  }
}

function checkNumbers(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value)) fail();
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) checkNumbers(child);
  }
}

/** New hub submissions only. A receipt remains intake-only, not canonical acceptance.
 * Keep committed-key lookup before this call so historical identical retries survive.
 */
export function validateHubSubmission(input: SubmissionInput): void {
  if (input.topic !== "intelligence-hub-v1") return;
  const body = input.body_markdown;
  if (body.length > 50_000 || Buffer.byteLength(body, "utf8") > 50_000 ||
      !body.startsWith(prefix) || !body.endsWith(suffix)) fail();
  const raw = body.slice(prefix.length, -suffix.length);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail(); }
  checkTokens(raw);
  checkNumbers(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const record = value as Record<string, unknown>;
  if (record.schema_version !== "1" || typeof record.report_markdown !== "string" ||
      !record.report_markdown.trim() || typeof record.run_id !== "string" ||
      !/^[A-Za-z0-9_-]{16,100}$/u.test(record.run_id) || record.run_id !== input.idempotency_key) fail();
}
