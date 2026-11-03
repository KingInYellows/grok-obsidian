# Hub submission guard

## Behavior

For NEW `intelligence-hub-v1` requests, the storage boundary now validates the exact
marker/JSON fence and payload before any pending, original, inbox or committed
publication. It rejects malformed JSON, duplicate decoded keys (including escaped
aliases), more than 32 nested containers, non-finite numeric values, invalid decoded
Unicode, unsupported schema_version, blank/missing report_markdown and a run_id
that does not match the idempotency key. IDs use 16–100 ASCII letters/digits/_/-.
The existing body/request/note bounds remain; hub bodies also enforce the 50,000
UTF-8 bytes/UTF-16 units contract at this seam. No new dependency was added.

The guard does not implement the full canonical submission schema or factual
validation. Accepted still means intake only; relay validation, archival, views,
synchronization and natural scheduling are distinct. General non-hub submissions
are unchanged. Existing identical committed-key retries return their original
receipt after request-hash and original-integrity checks, including historical
malformed hub submissions. Changed-content reuse remains a conflict. No existing
record is rewritten, reclassified, retried or promoted by this change. Historical
private-original reads retain the supported 128 KiB storage ceiling, so lowering
the future-note admission limit cannot block startup or intact receipt retries.

MCP errors use the existing InputError path with a bounded generic diagnostic. No
payload fragments, run IDs or private paths are returned in the guard diagnostic.

## Verification and rollout

Run `npm run validate` on the supported Linux runtime. The synthetic tests cover
malformed framing/JSON, duplicate decoded keys, depth and Unicode bounds, finite
numbers, version/report/identity checks, no publication on rejection, exact retained
bytes and receipt hashes, retry/conflict/restart behavior, legacy malformed committed
retries, unchanged non-hub behavior, and loopback MCP errors without acceptance.

A separate synthetic cross-runtime qualification verified that a canonical relay
reader could consume the Node-produced audit/original pair with exact body and hash
identity, validate its submission, and create one local archived preview over two
relay ticks. No outbound publication or live services were used. That establishes
compatibility only; it does not prove a natural producer run or downstream delivery.

Build an immutable candidate from reviewed source and locked dependencies before an
authorized service switch. Preserve protected originals, committed receipts, and
pending transactions. Coordinate the producer contract and monitoring expectations
separately. Do not replay or promote historical malformed records. Rolling back to
a binary without the guard reopens malformed admission; stop affected delivery and
review compatibility before any rollback.

Acceptance remains intake-only. Natural scheduling and downstream archival/view
delivery require separate observation. Curator integration is outside this change.
