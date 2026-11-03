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
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { ConfigurationError, InputError, StorageUnavailableError } from "./errors.js";
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
  readonly checkpoint: (stage: string) => Promise<void>;
  readonly availableBytes: (directory: string) => Promise<bigint>;
}

const defaultDependencies: StorageDependencies = {
  randomUuid: randomUUID,
  checkpoint: async () => undefined,
  now: () => new Date(),
  availableBytes: async (directory) => {
    const stats = await statfs(directory, { bigint: true });
    return stats.bavail * stats.bsize;
  },
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

async function writeExclusive(
  filePath: string,
  content: string,
  mode: 0o600 | 0o640 = 0o600,
): Promise<void> {
  const handle = await open(
    filePath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    // Descriptor-based chmod preserves the exact candidate mode under a restrictive umask.
    if (mode === 0o640) await handle.chmod(mode);
    await handle.sync();
    await handle.close();
  } catch (error) {
    // Only clean up after this call successfully created the file with O_EXCL.
    // In particular, an existing collision must never be unlinked.
    await handle.close().catch(() => undefined);
    await removeIfPresent(filePath);
    throw error;
  }
}

async function removeIfPresent(filePath: string): Promise<void> {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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
  readonly #originalsDir: string;
  #recoveryRequired = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(config: AppConfig, dependencies: Partial<StorageDependencies> = {}) {
    this.#config = config;
    this.#dependencies = { ...defaultDependencies, ...dependencies };
    this.#pendingDir = path.join(config.auditDir, "pending");
    this.#committedDir = path.join(config.auditDir, "committed");
    this.#originalsDir = path.join(config.auditDir, "originals");
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
    await mkdir(this.#originalsDir, { recursive: true, mode: 0o700 });
    await validateDirectoryBoundary(this.#config.stagingRoot, this.#originalsDir, "original directory");
    await this.#assertPrivateOriginalDirectory();
    await syncDirectory(this.#config.auditDir);
    await this.#reconcilePendingRecords();
    await this.#loadCommittedRecords();
  }

  async submit(ownerSubject: string, input: SubmissionInput): Promise<SubmissionReceipt> {
    return this.#exclusive(async () => {
      if (this.#recoveryRequired) throw new StorageUnavailableError("Storage recovery requires restart.");
      await this.#assertRuntimeBoundary();
      await this.#assertPrivateOriginalDirectory();
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
        if (existing.original_sha256) await this.#readOriginal(existing);
        return receiptFrom(existing);
      }

      await this.#assertStorageAvailable();
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

        let record: SubmissionRecord = {
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

        record = { ...record, original_sha256: sha256(note) };
        await this.#assertOriginalCapacity(Buffer.byteLength(note, "utf8"));
        const originalPath = path.join(this.#originalsDir, `${noteId}.md`);
        const originalTemp = path.join(this.#originalsDir, `${noteId}.partial`);
        const pendingPath = path.join(this.#pendingDir, `${noteId}.json`);
        const committedPath = path.join(this.#committedDir, `${noteId}.json`);
        const pendingTemp = path.join(this.#pendingDir, `${noteId}.partial`);
        const tempPath = path.join(this.#config.inboxDir, tempFilename);
        const finalPath = path.join(this.#config.inboxDir, filename);
        // Avoid known collisions before retaining a private original. Any later race
        // fails closed and is reconciled from the private transaction on restart.
        let collision = false;
        for (const candidate of [pendingPath, pendingTemp, committedPath, originalPath, originalTemp, tempPath, finalPath]) {
          const found = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return undefined;
          });
          if (found) collision = true;
        }
        if (collision) continue;
        let pendingCreated = false;
        let pendingTempCreated = false;
        let tempCreated = false;
        let originalTempCreated = false;
        let originalPublished = false;
        try {
          await writeExclusive(pendingTemp, `${JSON.stringify(record)}\n`, this.#config.privateFileMode);
          pendingTempCreated = true;
          await this.#dependencies.checkpoint("pending-temp");
          await link(pendingTemp, pendingPath);
          pendingCreated = true;
          await this.#dependencies.checkpoint("pending-linked");
          await removeIfPresent(pendingTemp);
          pendingTempCreated = false;
          await syncDirectory(this.#pendingDir);
          await this.#dependencies.checkpoint("pending");
          await writeExclusive(originalTemp, note, this.#config.privateFileMode);
          originalTempCreated = true;
          await this.#dependencies.checkpoint("original-temp");
          await link(originalTemp, originalPath);
          originalPublished = true;
          await this.#dependencies.checkpoint("original-linked");
          await removeIfPresent(originalTemp);
          originalTempCreated = false;
          await syncDirectory(this.#originalsDir);
          await this.#readOriginal(record);
          await this.#dependencies.checkpoint("original");
          await writeExclusive(tempPath, note, this.#config.noteFileMode);
          tempCreated = true;
          await link(tempPath, finalPath);
          await this.#dependencies.checkpoint("inbox-linked");
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
          await syncDirectory(this.#config.inboxDir);
          await this.#dependencies.checkpoint("inbox");
          await rename(pendingPath, committedPath);
          await syncDirectory(this.#committedDir);
          await syncDirectory(this.#pendingDir);
          await this.#dependencies.checkpoint("committed");
          this.#remember(record);
          return receiptFrom(record);
        } catch (error) {
          if (originalPublished) {
            // Never remove a durable original or a possibly curator-edited publication.
            // Retain the transaction for restart reconciliation; no second submission now.
            this.#recoveryRequired = true;
            throw error;
          }
          if (tempCreated) await removeIfPresent(tempPath);
          if (originalTempCreated) await removeIfPresent(originalTemp);
          if (pendingCreated) await removeIfPresent(pendingPath);
          if (pendingTempCreated) await removeIfPresent(pendingTemp);
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

  async #assertPrivateOriginalDirectory(): Promise<void> {
    await validateDirectoryBoundary(this.#config.stagingRoot, this.#originalsDir, "original directory");
    const info = await lstat(this.#originalsDir);
    if ((info.mode & 0o022) || (process.getuid && info.uid !== process.getuid())) {
      throw new ConfigurationError("original directory must be service-owned and not shared-writable");
    }
  }

  async #readOriginal(record: SubmissionRecord): Promise<Buffer> {
    const handle = await open(path.join(this.#originalsDir, `${record.note_id}.md`), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > this.#config.maxNoteBytes ||
          (info.mode & 0o022) || (process.getuid && info.uid !== process.getuid())) {
        throw new ConfigurationError("original failed regular-file safety check");
      }
      const bytes = await handle.readFile();
      if (createHash("sha256").update(bytes).digest("hex") !== record.original_sha256) {
        throw new ConfigurationError("original integrity mismatch");
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  async #assertOriginalCapacity(additionalBytes: number): Promise<void> {
    let count = 0;
    let bytes = 0;
    for (const entry of await readdir(this.#originalsDir, { withFileTypes: true })) {
      const info = await lstat(path.join(this.#originalsDir, entry.name));
      if (!entry.isFile() || !/^grn_[a-f0-9]{32}\.(md|partial)$/u.test(entry.name) || info.nlink !== 1) {
        throw new ConfigurationError("unexpected original storage entry");
      }
      count += 1;
      bytes += info.size;
    }
    if (count >= this.#config.maxOriginals || bytes + additionalBytes > this.#config.maxOriginalBytes) {
      throw new StorageUnavailableError("New submissions are paused because original storage is full.");
    }
  }

  async #assertStorageAvailable(): Promise<void> {
    try {
      for (const directory of [this.#config.inboxDir, this.#config.auditDir]) {
        const available = await this.#dependencies.availableBytes(directory);
        if (typeof available !== "bigint" || available < BigInt(this.#config.minFreeBytes)) {
          throw new StorageUnavailableError("New submissions are paused because storage is unavailable.");
        }
      }
    } catch {
      // Do not expose filesystem paths or underlying statfs errors to the caller.
      throw new StorageUnavailableError("New submissions are paused because storage is unavailable.");
    }
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
    // Metadata is staged and fsynced before its committed pending name appears.
    // No original can be published until these temporary metadata links are gone.
    for (const entry of entries) {
      if (entry.isFile() && /^grn_[a-f0-9]{32}\.partial$/u.test(entry.name)) {
        await removeIfPresent(path.join(this.#pendingDir, entry.name));
      }
    }
    await syncDirectory(this.#pendingDir);
    const records = entries.filter(entry =>
      !(entry.isFile() && /^grn_[a-f0-9]{32}\.partial$/u.test(entry.name)),
    );
    for (const entry of records) {
      if (!entry.isFile() || !/^grn_[a-f0-9]{32}\.json$/u.test(entry.name)) {
        throw new ConfigurationError("pending audit directory contains an unexpected entry");
      }
      const pendingPath = path.join(this.#pendingDir, entry.name);
      const record = await this.#readRecord(pendingPath);
      if (`${record.note_id}.json` !== entry.name || !record.original_sha256) {
        throw new ConfigurationError("pending legacy transaction requires migration review");
      }
      const originalPath = path.join(this.#originalsDir, `${record.note_id}.md`);
      const originalTemp = path.join(this.#originalsDir, `${record.note_id}.partial`);
      const committedPath = path.join(this.#committedDir, entry.name);
      const originalStats = await lstat(originalPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      if (!originalStats) {
        // Interrupted before publication: no acceptance was returned. Do not use a
        // synced note to manufacture a trusted original during recovery.
        await removeIfPresent(originalTemp);
        await removeIfPresent(pendingPath);
        await syncDirectory(this.#pendingDir);
        continue;
      }
      // A kill between link and unlink can leave our two private names for one inode.
      const tempStats = await lstat(originalTemp).catch(() => undefined);
      if (tempStats && tempStats.ino === originalStats.ino && tempStats.dev === originalStats.dev) {
        await removeIfPresent(originalTemp);
      }
      await this.#readOriginal(record);
      await syncDirectory(this.#originalsDir);
      // Do not inspect, restore, remove or rewrite the curator-owned synced copy.
      const existingCommit = await lstat(committedPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      if (existingCommit) {
        const committed = await this.#readRecord(committedPath);
        if (JSON.stringify(committed) !== JSON.stringify(record)) {
          throw new ConfigurationError("pending transaction conflicts with committed record");
        }
        await removeIfPresent(pendingPath);
      } else {
        await rename(pendingPath, committedPath);
      }
      await syncDirectory(this.#committedDir);
      await syncDirectory(this.#pendingDir);
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
      if (record.original_sha256) await this.#readOriginal(record);
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
