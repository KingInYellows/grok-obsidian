# Grok Obsidian MCP: planning package

Status: planning only. No Obsidian vault, Cloudflare account, Grok account, credentials, tunnel, or external service was accessed or changed while preparing this package.

Implementation status: the approved local server is now built and validated. See [Implementation readiness](IMPLEMENTATION-READINESS.md). The planning records below are preserved as the design history.

This package designs a narrowly scoped connector through which the cloud Grok app can submit research notes to one dedicated inbox in a shared Obsidian vault. Grok must never receive general vault access. Hermes remains the human-controlled curator that reviews and promotes notes.

Recommended direction, pending approval: run a tiny Streamable-HTTP MCP service on `127.0.0.1` under a low-privilege OS account. It writes candidates only to one fixed staging directory, preferably outside the canonical vault. Publish the single `/mcp` endpoint through a durable named Cloudflare Tunnel, then have Hermes review, sanitize, deduplicate, and promote a candidate into a separately authored canonical note.

The named Tunnel is a reachability layer, not authentication. Use Cloudflare Access Managed OAuth only after a harmless Grok compatibility proof succeeds and only when the origin validates the Access JWT. Do not replace an incompatible OAuth flow with a public endpoint or shared static token. R2 plus a Worker remains an isolated no-tunnel alternative, but requires a separate approved importer/sync path into Obsidian.

Read in this order:

1. [Problem statement and scope](01-problem-statement-and-scope.md)
2. [Threat model](02-threat-model.md)
3. [Architecture decision record](03-architecture-decision-record.md)
4. [MCP contract and data schema](04-mcp-contract-and-schema.md)
5. [Operations and acceptance plan](05-operations-and-acceptance.md)
6. [Decision questions](06-decision-questions.md)
7. [Primary-source registry](SOURCES.md)
8. [Implementation readiness](IMPLEMENTATION-READINESS.md)

## Boundaries that apply to every option

- The exposed tool set is exactly `submit_research_note` and optionally `list_submissions`.
- Neither tool accepts a path, filename, glob, query, command, URL-to-fetch, attachment, delete flag, rename instruction, or promotion instruction.
- The server owns the fixed inbox location and generated filename. It follows no symlinks or Windows reparse points when a local filesystem is used.
- Hermes, not Grok, reviews, edits, classifies, moves, promotes, or deletes notes.
- The system does not read arbitrary vault content. The optional list operation reads only its own immutable submission ledger, not the current text of vault files.
- No implementation or account configuration is authorized by this document.
