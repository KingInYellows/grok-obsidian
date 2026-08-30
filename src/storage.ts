import { constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { ConfigurationError, InputError } from "./errors.js";
import {
  assertSafeGeneratedBasename,
  isStrictlyContained,
  validateDirectoryBoundary,
} from "./path-safety.js";
import { submissionRecordSchema } from "./schema.js";
import type {
  AppConfig,
  SubmissionInput,
  SubmissionMetadata,
  SubmissionPage,
  SubmissionReceipt,
  SubmissionRecord,
} from "./types.js";

interface StorageDependencies {
  readonly randomUuid: () => string;
  readonly now: () => Date;
}

const defaultDependencies: StorageDependencies = {
  randomUuid: randomUUID,
  now: () => new Date(),
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function safeSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60)
      .replace(/-+$/gu, "") || "research"
  );
}

function filenameTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/gu, "");
}

function markdownHeading(value: string): string {
  const htmlEscaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return htmlEscaped.replace(/([\\`*_{}\[\]()#+.!-])/gu, "\\$1");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderNote(record: SubmissionRecord, input: SubmissionInput): string {
  const sourceLines = input.source_urls?.length
    ? ["source_urls:", ...input.source_urls.map((url) => `  - ${yamlString(url)}`)]
    : ["source_urls: []"];
  const topicLine = input.topic ? `topic: ${yamlString(input.topic)}\n` : "";
  return [
    "---",
    `id: ${yamlString(record.note_id)}`,
    "producer: grok-research-mcp",
    `owner_subject: ${yamlString(record.owner_subject)}`,
    `submitted_at: ${yamlString(record.submitted_at)}`,
    "status: inbox",
    `title: ${yamlString(record.title)}`,
    topicLine.trimEnd(),
    ...sourceLines,
    `content_sha256: ${yamlString(record.content_sha256)}`,
    "---",
    "",
    `# ${markdownHeading(record.title)}`,
    "",
    "> [!warning] Untrusted external research",
    "> Review, sanitize, and deduplicate this candidate before promotion.",
    "",
    "## Submitted research",
    "",
    input.body_markdown,
    "",
  ]
    .filter((line, index, lines) => !(line === "" && index > 0 && lines[index - 1] === ""))
    .join("\n");
}

function canonicalRequest(input: SubmissionInput): string {
  return JSON.stringify({
    title: input.title,
    body_markdown: input.body_markdown,
    source_urls: input.source_urls ?? [],
    topic: input.topic ?? null,
  });
}

function receiptFrom(record: SubmissionRecord): SubmissionReceipt {
  return {
    note_id: record.note_id,
    submitted_at: record.submitted_at,
    status: "accepted",
    content_sha256: record.content_sha256,
  };
}

function metadataFrom(record: SubmissionRecord): SubmissionMetadata {
  return {
    ...receiptFrom(record),
    title: record.title,
    ...(record.topic ? { topic: record.topic } : {}),
  };
}

async function writeExclusive(filePath: string, content: string): Promise<void> {
  const handle = await open(
    filePath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeIfPresent(filePath: string): Promise<void> {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function encodeCursor(noteId: string): string {
  return Buffer.from(JSON.stringify({ version: 1, note_id: noteId }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): string {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("version" in decoded) ||
      decoded.version !== 1 ||
      !("note_id" in decoded) ||
      typeof decoded.note_id !== "string" ||
      !/^grn_[a-f0-9]{32}$/u.test(decoded.note_id)
    ) {
      throw new Error("invalid cursor");
    }
    return decoded.note_id;
  } catch {
    throw new InputError("cursor is invalid");
  }
}

export class SubmissionStore {
  readonly #config: AppConfig;
  readonly #dependencies: StorageDependencies;
  readonly #recordsByNoteId = new Map<string, SubmissionRecord>();
  readonly #recordsByIdempotency = new Map<string, SubmissionRecord>();
  readonly #pendingDir: string;
  readonly #committedDir: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(config: AppConfig, dependencies: Partial<StorageDependencies> = {}) {
    this.#config = config;
    this.#dependencies = { ...defaultDependencies, ...dependencies };
    this.#pendingDir = path.join(config.auditDir, "pending");
    this.#committedDir = path.join(config.auditDir, "committed");
  }

  async initialize(): Promise<void> {
    await this.#assertRuntimeBoundary();
    await mkdir(this.#pendingDir, { recursive: true, mode: 0o700 });
    await mkdir(this.#committedDir, { recursive: true, mode: 0o700 });
    await validateDirectoryBoundary(this.#config.stagingRoot, this.#pendingDir, "pending audit directory");
    await validateDirectoryBoundary(
      this.#config.stagingRoot,
      this.#committedDir,
      "committed audit directory",
    );
    await this.#reconcilePendingRecords();
    await this.#loadCommittedRecords();
  }

  async submit(ownerSubject: string, input: SubmissionInput): Promise<SubmissionReceipt> {
    return this.#exclusive(async () => {
      await this.#assertRuntimeBoundary();
      for (const value of [input.title, input.body_markdown, input.topic ?? "", ...(input.source_urls ?? [])]) {
        if (hasUnpairedSurrogate(value)) {
          throw new InputError("input contains invalid Unicode");
        }
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.body_markdown)) {
        throw new InputError("research body contains an unsupported control character");
      }
      if (Buffer.byteLength(input.body_markdown, "utf8") > this.#config.maxResearchBytes) {
        throw new InputError("research body exceeds the configured byte limit");
      }

      const requestHash = sha256(canonicalRequest(input));
      const idempotencyIndex = `${ownerSubject}\u0000${input.idempotency_key}`;
      const existing = this.#recordsByIdempotency.get(idempotencyIndex);
      if (existing) {
        if (existing.request_sha256 !== requestHash) {
          throw new InputError("idempotency key was already used for different content");
        }
        return receiptFrom(existing);
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const submittedAt = this.#dependencies.now();
        if (Number.isNaN(submittedAt.getTime())) {
          throw new Error("clock returned an invalid date");
        }
        const uuid = this.#dependencies.randomUuid().replaceAll("-", "").toLowerCase();
        if (!/^[a-f0-9]{32}$/u.test(uuid)) {
          throw new Error("UUID generator returned an invalid identifier");
        }
        const noteId = `grn_${uuid}`;
        if (this.#recordsByNoteId.has(noteId)) continue;
        const filename = `${filenameTimestamp(submittedAt)}--${safeSlug(input.title)}--${uuid.slice(0, 12)}.md`;
        const tempFilename = `${noteId}.partial`;
        assertSafeGeneratedBasename(filename, "generated filename");
        assertSafeGeneratedBasename(tempFilename, "generated temporary filename");

        const record: SubmissionRecord = {
          note_id: noteId,
          submitted_at: submittedAt.toISOString(),
          status: "accepted",
          content_sha256: sha256(input.body_markdown),
          title: input.title,
          ...(input.topic ? { topic: input.topic } : {}),
          owner_subject: ownerSubject,
          idempotency_key: input.idempotency_key,
          request_sha256: requestHash,
          filename,
          temp_filename: tempFilename,
        };
        const note = renderNote(record, input);
        if (Buffer.byteLength(note, "utf8") > this.#config.maxNoteBytes) {
          throw new InputError("rendered note exceeds the configured byte limit");
        }

        const pendingPath = path.join(this.#pendingDir, `${noteId}.json`);
        const committedPath = path.join(this.#committedDir, `${noteId}.json`);
        const tempPath = path.join(this.#config.inboxDir, tempFilename);
        const finalPath = path.join(this.#config.inboxDir, filename);
        let pendingCreated = false;
        let tempCreated = false;
        let finalPublished = false;
        try {
          await writeExclusive(pendingPath, `${JSON.stringify(record)}\n`);
          pendingCreated = true;
          await writeExclusive(tempPath, note);
          tempCreated = true;
          await link(tempPath, finalPath);
          finalPublished = true;
          await removeIfPresent(tempPath);
          tempCreated = false;
          const finalStats = await lstat(finalPath);
          if (!finalStats.isFile() || finalStats.isSymbolicLink() || finalStats.nlink !== 1) {
            throw new ConfigurationError("published note failed the regular-file safety check");
          }
          const physicalFinalPath = await realpath(finalPath);
          if (!isStrictlyContained(this.#config.inboxDir, physicalFinalPath)) {
            throw new ConfigurationError("published note resolved outside the inbox directory");
          }
          await rename(pendingPath, committedPath);
          this.#remember(record);
          return receiptFrom(record);
        } catch (error) {
          if (tempCreated) await removeIfPresent(tempPath);
          if (finalPublished) await removeIfPresent(finalPath);
          if (pendingCreated) await removeIfPresent(pendingPath);
          if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
          throw error;
        }
      }
      throw new Error("could not allocate a collision-free submission identifier");
    });
  }

  async list(ownerSubject: string, limit: number, cursor?: string): Promise<SubmissionPage> {
    return this.#exclusive(async () => {
      const records = [...this.#recordsByNoteId.values()]
        .filter((record) => record.owner_subject === ownerSubject)
        .sort((left, right) => {
          const timeOrder = right.submitted_at.localeCompare(left.submitted_at);
          return timeOrder || right.note_id.localeCompare(left.note_id);
        });

      let start = 0;
      if (cursor) {
        const noteId = decodeCursor(cursor);
        const index = records.findIndex((record) => record.note_id === noteId);
        if (index < 0) throw new InputError("cursor is invalid for this subject");
        start = index + 1;
      }
      const selected = records.slice(start, start + limit);
      const hasMore = start + selected.length < records.length;
      return {
        submissions: selected.map(metadataFrom),
        ...(hasMore && selected.length > 0
          ? { next_cursor: encodeCursor(selected[selected.length - 1]!.note_id) }
          : {}),
      };
    });
  }

  async #assertRuntimeBoundary(): Promise<void> {
    await validateDirectoryBoundary(
      this.#config.stagingRoot,
      this.#config.inboxDir,
      "inbox directory",
    );
    await validateDirectoryBoundary(
      this.#config.stagingRoot,
      this.#config.auditDir,
      "audit directory",
    );
  }

  async #reconcilePendingRecords(): Promise<void> {
    const entries = await readdir(this.#pendingDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^grn_[a-f0-9]{32}\.json$/u.test(entry.name)) {
        throw new ConfigurationError("pending audit directory contains an unexpected entry");
      }
      const pendingPath = path.join(this.#pendingDir, entry.name);
      const record = await this.#readRecord(pendingPath);
      const finalPath = path.join(this.#config.inboxDir, record.filename);
      const tempPath = path.join(this.#config.inboxDir, record.temp_filename);
      const committedPath = path.join(this.#committedDir, entry.name);
      await removeIfPresent(tempPath);
      const finalStats = await lstat(finalPath).catch(() => undefined);
      if (finalStats?.isFile() && !finalStats.isSymbolicLink() && finalStats.nlink === 1) {
        await rename(pendingPath, committedPath);
      } else {
        await removeIfPresent(pendingPath);
      }
    }
  }

  async #loadCommittedRecords(): Promise<void> {
    const entries = await readdir(this.#committedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^grn_[a-f0-9]{32}\.json$/u.test(entry.name)) {
        throw new ConfigurationError("committed audit directory contains an unexpected entry");
      }
      const record = await this.#readRecord(path.join(this.#committedDir, entry.name));
      if (`${record.note_id}.json` !== entry.name) {
        throw new ConfigurationError("audit record filename does not match its note ID");
      }
      this.#remember(record);
    }
  }

  async #readRecord(recordPath: string): Promise<SubmissionRecord> {
    const stats = await lstat(recordPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 16_384) {
      throw new ConfigurationError("audit record failed the regular-file safety check");
    }
    const content = await readFile(recordPath, "utf8");
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new ConfigurationError("audit record is not valid JSON");
    }
    const parsed = submissionRecordSchema.safeParse(decoded);
    if (!parsed.success) throw new ConfigurationError("audit record failed schema validation");
    assertSafeGeneratedBasename(parsed.data.filename, "audit filename");
    assertSafeGeneratedBasename(parsed.data.temp_filename, "audit temporary filename");
    return parsed.data;
  }

  #remember(record: SubmissionRecord): void {
    if (this.#recordsByNoteId.has(record.note_id)) {
      throw new ConfigurationError("duplicate note ID in audit records");
    }
    const idempotencyIndex = `${record.owner_subject}\u0000${record.idempotency_key}`;
    if (this.#recordsByIdempotency.has(idempotencyIndex)) {
      throw new ConfigurationError("duplicate idempotency key in audit records");
    }
    this.#recordsByNoteId.set(record.note_id, record);
    this.#recordsByIdempotency.set(idempotencyIndex, record);
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
