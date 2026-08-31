# Threat model

> Historical planning record from 2026-08-29. These original assumptions and questions are not the current deployment status or a new authorization request. See [project status](../docs/PROJECT-STATUS.md) for recorded acceptance and remaining checks.

## Assets

- The confidentiality and integrity of every vault item outside `Grok Research Inbox`.
- The integrity, provenance, and review state of submitted research.
- Connector authorization material, Tunnel credentials if used, and Cloudflare deployment credentials.
- The availability of the intake lane without making the vault host a public general-purpose service.

## Trust boundaries

```text
Untrusted research instructions/content
       |
       v
Grok cloud and connector client -- HTTPS/auth --> constrained MCP service
                                                   |             |
                                                   |             +--> append-only submission ledger
                                                   v
                                     fixed staging inbox only
                                                   |
                                                   v
                                      Hermes review and promotion
```

Grok is authorized to submit untrusted content through narrow tools. It is not trusted to select an output path, preserve frontmatter, make classification decisions, or interpret content as instructions for privileged systems.

## Threats and controls

| Threat | Example | Required controls | Residual risk |
| --- | --- | --- | --- |
| Path escape | `../../.obsidian/app.json` in a title or hidden Unicode path separator | No path or filename input. Generate names from server timestamp, random identifier, and a conservative slug. Join only to a preconfigured root and verify containment after canonicalization. | A bug in the server's path handling can still violate confinement; test it directly. |
| Symlink/reparse escape | Inbox child points at another vault directory | Create the inbox during approved setup; deny symlinks and Windows reparse points for every resolved component; use non-following, exclusive file creation. | Filesystem race conditions need platform-specific tests. |
| Tool expansion | A future `search_notes` or `move_note` makes all vault data reachable | Treat tool-list changes as a security boundary change requiring a new ADR and approval. Configure Grok with the explicit two-tool allowlist where supported. | A connector client can still call any published tool unless server and deployment tooling prevent its exposure. |
| Stolen/replayed credential | Captured credential submits spam | Use Cloudflare Access Managed OAuth only after the exact Grok flow proves compatible and only if the origin validates the Access JWT. Use short-lived tokens, throttling, idempotency, and revocation. Do not fall back to a shared static token or public endpoint. Never log authorization headers. | A valid caller can still submit harmful or low-quality candidates. |
| Prompt or frontmatter injection | A candidate tells Hermes to reveal data, or tries to escape server-owned YAML | Treat all submitted content as untrusted research. Reject frontmatter delimiters/injection in structured fields; render server-owned Markdown from validated fields; do no server-side fetch, rendering, execution, templating, or link preview. Curator prompts must treat candidates as data. | Human review can be socially engineered. |
| Unauthorized disclosure | List operation returns a Hermes-edited note or another user's research | `list_submissions` reads immutable service-owned audit records, scoped to the authenticated subject, not current filesystem files. It returns metadata only. | Submission metadata may still reveal timing and title. |
| Vault-host compromise through public exposure | Internet scans reach a local service | Bind the MCP origin to `127.0.0.1`; expose only `/mcp` through a named Cloudflare Tunnel; validate `Origin`; require origin-validated Access JWTs. Keep the writable staging directory outside the vault where practical. | Local host compromise defeats local filesystem protections. |
| DoS and storage abuse | Very large candidates or high-rate calls | Strict schema limits, request body cap, per-subject and per-IP rate limits, quota, timeouts, backpressure, and a bounded retention policy for audit metadata. | Service-level resource exhaustion requires monitoring and provider protections. |
| Partial write or sync conflict | Power loss after file creation; sync client edits a new note | Write atomically into a fixed staging directory with an exclusive final name; one candidate per submission; do not modify it later. Keep audit metadata outside the vault and surface a receipt. Hermes creates the canonical note separately. | An interrupted promotion remains a curator workflow concern. |
| Audit log leakage | Logs retain research bodies or tokens | Log only event ID, subject pseudonym, timestamp, tool name, outcome, byte count, and error class. Redact URLs if they may be sensitive. Use short retention. | Metadata can still be sensitive. |

## Design invariants

- Content is treated as bytes/Markdown, never as code, a template, or a command.
- The server has no endpoint that dereferences a URL supplied by Grok.
- The local variant uses a dedicated OS account whose only write permission is the staging folder, with no read permission beyond what the implementation requires.
- The cloud variant has no credential that can access the full vault. Its credential can write only the cloud intake store.
- Promotion requires a distinct curator action and is not representable in the MCP contract.
