# Operational model and acceptance plan

> Current status, 2026-08-31: See the [acceptance matrix](../docs/PROJECT-STATUS.md#evidence-and-limits). Authenticated relay, Grok OAuth/discovery, one durable live submission, the free-space guard are recorded as passed. Cross-client receipt, renewal/reconnect, full restore and Hermes promotion remain open. Earlier planned phases and gate lists below are historical; this document does not authorize replaying them.

## Ownership

| Role | Responsibilities |
| --- | --- |
| User | Select topology, identity model, retention, and deployment authority. Approve all external-account and vault actions. |
| Grok | Submit research through `submit_research_note` only in the deployed profile. It has no curator authority. |
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

1. Build a mock Streamable HTTP MCP endpoint with only the intended tools and a temporary non-sensitive storage fixture.
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
- The only remotely discoverable tools are exactly those enabled by the approved deployment profile, and the Grok configuration uses an allowlist where available.
- Authentication is required, revocation works, and no sensitive data appears in test logs.
- A duplicate request yields one note.
- A test symlink/reparse-point attempt fails safely.
- Hermes can sanitize, deduplicate, and separately author/promote a synthetic canonical note; Grok cannot.
- The selected topology's recovery behavior is documented and tested: tunnel/host outage for A, queue/importer outage for B.

No real-vault rollout should begin until all applicable criteria pass and the user explicitly authorizes the next phase.

## Vault proof gate added on 2026-08-30

Run this gate before finalizing promotion or starting production intake. The earlier phase numbers describe the connector tests; they do not authorize vault access, account changes, or public activation. The [public status summary](../docs/PROJECT-STATUS.md) identifies current evidence gaps; the procedure below is a template for separately authorized client tests.

1. User names the trusted writing client, its canonical vault path, intended receiving clients, permitted test folder, and curator identity. Confirm only one Sync implementation operates on each device. Record the selected directions explicitly.
2. Obtain scoped permission for a uniquely named synthetic note and exact-file reads/hashes on those clients. Record approval, UTC and America/Chicago timestamps, application/sync versions, run ID, and expected file digest. Do not enumerate private notes or inspect credential/configuration files.
3. Under that approval, create one synthetic Markdown note on the trusted writer, with no private content. Verify arrival on the reference host and each named receiver using its exact path and full-file hash. Check only test-ID-matching entries for duplicate/conflict artifacts in the approved test folder. Record per-client outcomes and timestamps. A missing or mismatched file is a failed proof, not permission to change settings.
4. Update only that synthetic note on the writer and repeat delivery verification. the reference host local writes are not part of this proof when pull-only is retained. If another direction is required, approve and test it explicitly.
5. Separately approve a bounded reconnect or restart on one named client. Record pre/post service state and recovery time; verify that the synthetic update arrives once and retains its digest. Stop on unexpected sync state or conflict. Do not stop services or alter network settings as part of the initial delivery-only approval.
6. Identify backup owner, mechanism, retention, protected destination, and restore procedure without reading private backups. After separate approval, restore only the synthetic fixture to an isolated destination and verify its full-file digest. Sync convergence alone does not prove backup recovery.
7. Under separate curator approval, deliver one synthetic intake candidate to Hermes, review it as untrusted text, and promote through the selected writer. Replay the same handoff and prove no second canonical note is created. Retain the immutable intake receipt. Record curator outcome separately; MCP listing must still report only `accepted`.
8. Agree on retention or cleanup of synthetic notes. Do not delete them, restore real notes, change sync mode, or grant permissions under the delivery-only scope.

Each evidence row records test/run ID, source and destination client aliases, direction, timestamps, versions, synthetic relative path, `file_sha256`, outcome, and any duplicate/conflict count. Keep body digest and full-file digest in separate fields. Record untested steps as pending. Keep account identifiers, secrets, private filenames/content, and raw sync logs out of the repository.

Public activation additionally requires the chosen hostname and Access identity, harmless OAuth proof, staging storage safeguards, and approved backup handling. No background monitoring is authorized by this plan.

## Recorded execution and open checks

The reference deployment's private acceptance records document restricted intake, server acknowledgement, local restart checks, Managed OAuth, single-tool discovery and one durable synthetic submission. The public [status summary](../docs/PROJECT-STATUS.md) distinguishes these recorded results from checks repeated during publication preparation.

Another client's receipt, return-direction edits, OAuth renewal/reconnect, full restore and curator promotion remain open. The selected request path includes an existing reverse proxy and a source-restricted relay; addresses and recovery procedures remain in private operator records.
