import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { ConfigurationError } from "./errors.js";

export function isStrictlyContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function assertNoLinkComponents(absolutePath: string, label: string): Promise<void> {
  const parsed = path.parse(absolutePath);
  const segments = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = await lstat(current).catch(() => undefined);
    if (!stats) throw new ConfigurationError(`${label} contains a missing path component`);
    if (stats.isSymbolicLink()) {
      throw new ConfigurationError(`${label} cannot traverse a symbolic link or reparse point`);
    }
  }
}

function hasDotPrefixedSegment(relativePath: string): boolean {
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .some((segment) => segment.startsWith("."));
}

export async function inspectExistingDirectory(
  configuredPath: string,
  label: string,
): Promise<string> {
  if (!path.isAbsolute(configuredPath)) {
    throw new ConfigurationError(`${label} must be an absolute path`);
  }

  const lexicalPath = path.resolve(configuredPath);
  const stats = await lstat(lexicalPath).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new ConfigurationError(`${label} must already exist as a directory`);
  }
  if (stats.isSymbolicLink()) {
    throw new ConfigurationError(`${label} cannot be a symbolic link or reparse point`);
  }

  await assertNoLinkComponents(lexicalPath, label);
  const physicalPath = await realpath(lexicalPath);
  if (path.basename(lexicalPath).startsWith(".")) {
    throw new ConfigurationError(`${label} cannot be dot-prefixed or hidden by name`);
  }
  return physicalPath;
}

export async function validateDirectoryBoundary(
  stagingRoot: string,
  candidate: string,
  label: string,
): Promise<void> {
  if (!isStrictlyContained(stagingRoot, candidate)) {
    throw new ConfigurationError(`${label} must be strictly inside the staging root`);
  }
  const relative = path.relative(stagingRoot, candidate);
  if (hasDotPrefixedSegment(relative)) {
    throw new ConfigurationError(`${label} cannot contain a dot-prefixed path segment`);
  }
  await inspectExistingDirectory(stagingRoot, "staging root");
  const physicalCandidate = await inspectExistingDirectory(candidate, label);
  if (!isStrictlyContained(stagingRoot, physicalCandidate)) {
    throw new ConfigurationError(`${label} resolves outside the staging root`);
  }
}

export function assertSafeGeneratedBasename(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.startsWith(".") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value !== path.basename(value)
  ) {
    throw new ConfigurationError(`${label} is not a safe generated basename`);
  }
}
