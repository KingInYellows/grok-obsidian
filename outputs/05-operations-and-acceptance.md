# Operational model and acceptance plan

## Ownership

| Role | Responsibilities |
| --- | --- |
| User | Select topology, identity model, retention, and deployment authority. Approve all external-account and vault actions. |
| Grok | Submit research through the two constrained tools only. It has no curator authority. |
| Connector service | Validate identity and schema, enforce limits, write immutable intake records, and produce minimal audit events. |
| Hermes | Review untrusted inbox notes, decide whether to promote, and perform any promotion through a separate trusted workflow. |
| Cloudflare, if selected | Host the Worker or publish the named Tunnel and enforce the approved edge authentication/policy. |

## Lifecycle

1. A user asks Grok to submit research.
2. Grok calls `submit_research_note` with untrusted Markdown and an idempotency key.
3. The MCP service authenticates, validates, records the submission, and returns a receipt.
4. Option A writes the new candidate directly into the local staging inbox. Option B queues it in cloud intake, and the local importer later writes the candidate atomically into staging.
5. Hermes reviews staging, sanitizes and deduplicates the candidate, then authors/promotes a separate canonical vault note. The original submission trace remains intact.

## Minimum production controls

- HTTPS only, Streamable HTTP at one explicit `/mcp` route, plus `Origin` validation per MCP transport guidance.
- A stable named Tunnel for Option A. Quick tunnels are useful only for an approved, disposable compatibility test because their URLs are temporary.
- Cloudflare Access Managed OAuth only after a compatibility proof, and origin validation of the Access JWT. A Tunnel solves reachability, not authorization. Do not use a public or shared-static-token fallback.
- Request size limits, 20-or-fewer list results, per-subject quotas, rate limits, and idempotency retention.
- Structured, redacted audit events. Do not log request bodies, authorization headers, tunnel credentials, cloud tokens, or note source URLs unless the user explicitly selects a privacy policy that permits them.
- Service-health monitoring that reveals only availability and counters, not note contents.
- A tested revoke procedure: disable the connector/client authorization, stop the ingress route, and retain logs/records according to the selected retention policy.

## Validation sequence, after separate approval

### Phase 0: design proof without a real vault

1. Build a mock Streamable HTTP MCP endpoint with only the two proposed tools and a temporary non-sensitive storage fixture.
2. Add it to the exact Grok custom connector surface the user intends to use.
3. Verify tool discovery, the Managed OAuth flow, `submit_research_note`, idempotency, and origin validation of the Access JWT.
4. Verify the user can restrict the available tools to the proposed allowlist where the Grok surface exposes that setting.
5. Record only sanitized protocol outcomes. Do not save tokens or account data.

Exit criterion: the selected Grok connector client demonstrably works with the selected transport and authorization method.

### Phase 1: adversarial contract tests

- Reject `../`, absolute paths, Windows drive paths, UNC paths, encoded traversal, NUL bytes, and extremely long titles.
- Reject symlink and reparse-point inbox fixtures; confirm no created file appears outside the test root.
- Confirm that a duplicate idempotency key produces one record and the original receipt.
- Confirm invalid body size, invalid URL, unknown fields, and malformed cursor fail without side effects.
- Confirm a caller cannot list another authenticated subject's records and that listing returns metadata only.
- Confirm no response contains a real path, secret, raw stack trace, or unrelated test data.
- Feed prompt-injection-looking Markdown and verify it is stored as text, with no server-side fetch or execution.
- Replay expired/revoked credentials and verify rejection.

### Phase 2: topology tests

For Option A: prove the origin binds only to loopback, the named Tunnel exposes only the designated route, the origin validates the Access JWT, and tunnel outage causes an observable but safe failure.

For Option B: prove the Worker cannot access the test vault, the importer makes outbound-only requests, an interrupted import is retried without duplicates, and the local write stays inside the test staging inbox.

### Phase 3: curator workflow test

Use synthetic research content. Hermes receives an inbox note, recognizes its producer/provenance, reviews it, and promotes it through the separately approved curator path. Confirm the connector cannot invoke that promotion path.

## Acceptance criteria

- Grok can create exactly one synthetic candidate in the fixed test staging inbox through `submit_research_note`.
- No observed request can create, modify, list, or disclose a file outside that staging inbox.
- The only remotely discoverable tools are the approved two, and the Grok configuration uses an allowlist where available.
- Authentication is required, revocation works, and no sensitive data appears in test logs.
- A duplicate request yields one note.
- A test symlink/reparse-point attempt fails safely.
- Hermes can sanitize, deduplicate, and separately author/promote a synthetic canonical note; Grok cannot.
- The selected topology's recovery behavior is documented and tested: tunnel/host outage for A, queue/importer outage for B.

No real-vault rollout should begin until all applicable criteria pass and the user explicitly authorizes the next phase.
