# MCP contract and data schema

> Current status, 2026-08-31: Production advertises only submit_research_note. The optional list_submissions implementation is disabled. The service sees only its fixed inbox bind; audit remains outside the vault. See [project status](../docs/PROJECT-STATUS.md) for recorded acceptance and limits. Earlier conceptual schemas describe the reusable implementation; src/schema.ts is the executable input definition.

The implementation supports the two tools below, but production advertises only `submit_research_note`. A deployment should additionally configure an xAI `allowed_tools` list when the connection method supports it. That list is defense in depth, not a substitute for a server that exposes nothing else. The service writes candidates into a fixed staging directory, preferably outside the canonical vault.

## `submit_research_note`

Purpose: submit one untrusted research candidate to the fixed staging inbox.

Input schema, conceptual JSON Schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "body_markdown", "idempotency_key"],
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 160},
    "body_markdown": {"type": "string", "minLength": 1, "maxLength": 50000},
    "source_urls": {
      "type": "array",
      "maxItems": 25,
      "items": {"type": "string", "format": "uri", "maxLength": 2048}
    },
    "topic": {"type": "string", "maxLength": 100},
    "idempotency_key": {"type": "string", "pattern": "^[A-Za-z0-9_-]{16,128}$"}
  }
}
```

The server rejects inputs that exceed byte limits after UTF-8 encoding, contain invalid Unicode, or fail schema validation. It does not fetch `source_urls` or turn them into links with active previews.

Server behavior:

1. Authenticate the caller and derive `owner_subject` from the validated identity, never from input.
2. Rate-limit and look up `(owner_subject, idempotency_key)`. Return the original receipt for a duplicate.
3. Generate an opaque note ID and a safe filename. The caller cannot choose either.
4. Reject frontmatter delimiters and control characters in caller-supplied fields that enter structured metadata. Render server-owned Markdown from validated fields. The submitted body follows the fixed closing frontmatter delimiter and is never parsed as configuration.
5. Store audit metadata outside the vault and return a minimal receipt. For Option A, atomically create a new candidate below the configured staging root. For Option B, write the record to the private cloud intake store for later import.

Conceptual persisted note:

```markdown
---
id: grn_01J...
producer: grok-research-mcp
owner_subject: subject_pseudonym
submitted_at: 2026-08-29T00:00:00Z
status: inbox
topic: optional user-supplied topic
source_urls:
  - https://example.org/source
content_sha256: "..."
---

# Server-rendered title

## Submitted research (untrusted)

Caller-supplied research body is rendered here as untrusted content.
```

The production implementation must escape YAML scalar values and reject control characters in metadata. It may use a standard YAML library, but it must never let submitted body fields alter generated frontmatter.

Success result:

```json
{
  "note_id": "grn_01J...",
  "submitted_at": "2026-08-29T00:00:00Z",
  "status": "accepted",
  "content_sha256": "..."
}
```

Do not return an absolute filesystem path, a storage object URL, vault configuration, directory listing, or any content from an existing note.

## `list_submissions`

Purpose: let the authenticated connector subject see compact metadata for its own accepted submissions.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "cursor": {"type": "string", "maxLength": 512},
    "limit": {"type": "integer", "minimum": 1, "maximum": 20}
  }
}
```

The tool queries only the service-owned immutable ledger for the authenticated `owner_subject`. It must not walk the staging directory or vault, inspect filesystem metadata, read an edited note, search note content, or disclose a path. Output is metadata only: `note_id`, `submitted_at`, sanitized `title`, `topic`, `status` fixed to `accepted`, and content digest. It returns no body preview.

## Forbidden capabilities

The protocol has no tools, resources, prompts, or endpoints for:

- `read_note`, `search_notes`, `list_files`, `get_vault_metadata`, or arbitrary resource access;
- create-with-path, overwrite, append-to-existing, rename, move, delete, promote, or restore;
- attachments, binary uploads, URL fetching, webhooks, shell commands, SQL, Git, or database queries;
- changing authentication, rate limits, server configuration, tunnel configuration, or Hermes policy.

## File-system invariant for Option A

The implementation receives a fixed absolute staging root at deployment time. It creates only `root/<server-generated-name>.md` through exclusive creation. It rejects traversal, hidden paths, symlinks/reparse points, and hardlinks; performs platform-appropriate non-following checks before and during the operation; and validates the final resolved location remains below the root. The service account has write-only access to that staging folder where the operating system permits it and no access to the canonical vault.

## Curator boundary after the resume review

Retain the implemented intake schema. The approved public profile exposes only `submit_research_note`, with metadata listing disabled. The service uses its fixed staging path, while an isolated bind maps only that inbox into the vault; service audit remains outside the vault. No vault destination, promotion flag, sync setting, or curator credential belongs in caller input.

`accepted` means the service recorded a candidate. It does not mean Hermes approved it, a canonical note exists, or any client received it. `list_submissions` remains a view of intake receipts and must not query Hermes or the vault to obtain review or sync status.

In the current implementation, `content_sha256` is SHA-256 of the UTF-8 `body_markdown`, not the rendered Markdown file or the full request. An unchanged replay returns the original receipt; reuse of the same subject/key with different request content is rejected. A full-file digest for synthetic delivery testing must be recorded separately as `file_sha256`.

Proposed Hermes handoff, outside MCP: preserve the intake ID and body digest as provenance, record the review decision separately, and author a separate canonical note only after approval. Preserve the original candidate and receipt. Deduplicate promotion by intake ID and record the canonical result in a curator-owned record inaccessible to Grok. Compare any edited canonical note against its own full-file digest, not the original body's digest. These curator records and delivery acknowledgements are proposed requirements, not implemented tools or existing services.

See [project status](../docs/PROJECT-STATUS.md) for the remaining curator and client-delivery checks.

## Implemented inbox mapping

For the reference deployment, the service still sees its fixed staging inbox path, but an isolated bind maps only that inbox to the dedicated directory inside the vault. Audit remains external. Candidate-only 0640 mode and the inbox ACL permit syncing; no vault paths or promotion capabilities were added to the protocol. See the [public status summary](../docs/PROJECT-STATUS.md).
