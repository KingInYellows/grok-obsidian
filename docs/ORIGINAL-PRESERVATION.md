# Private original preservation

New submissions retain the complete rendered UTF-8 note under
`<auditDir>/originals/<note_id>.md`, mode 0600 by default, independently written from the
synced inbox copy (never a hardlink to it). Internal audit metadata includes
`original_sha256`, hashing the entire rendered note. The submission tool arguments,
receipt, request/body digests and schema-v1 document inside the body remain unchanged.
No new tool, endpoint, sync process, URL fetch or producer authority is added.

`GROK_MCP_PRIVATE_FILE_MODE=0640` opts new originals and pending audit files into
group-readable publication. Use service-owned setgid directories and a dedicated
read-only consumer group; pending metadata retains its group/mode when committed.
The default remains 0600, and existing records are not changed automatically.

Order: exclusively create/fsync staged pending metadata, publish/fsync pending metadata;
exclusively create/fsync staged private original, publish/unlink temporary name/fsync
originals directory; publish/fsync inbox copy; commit audit metadata and fsync both audit
directories; only then return acceptance. Directory fsync must work; failure is not ignored.
The service-managed audit root and its originals subtree must stay outside every synced
vault and remain writable only by the service. Consumer read ACLs must never grant writes.
Filesystem and storage must honor fsync. This is not isolation from a root-capable agent.

Recovery uses only the private original and trusted metadata, never the possibly edited
synced note. Before private publication, an interrupted attempt is discarded and can be
retried with the same key. After private publication, the original is retained, verified
and committed on restart, even if the synced note disappeared. A failure after private
publication blocks new submissions in that process until restart reconciliation. An
identical retry then receives the original receipt. Recovery does not restore or edit
curator-owned inbox copies; temporary inbox artifacts may remain for operator review.
Acceptance means durable intake, not successful remote archival, sync or client receipt.
Corrupt, missing, unsafe or conflicting originals fail closed without overwriting evidence.

Committed legacy records without `original_sha256` keep their historical replay receipts;
they are NOT upgraded or backfilled from editable synced files. A legacy pending transaction
requires explicit migration review. New records cannot fall back to legacy consumption.
A relay must explicitly require originals and reject/quarantine legacy hub-tagged records
until a separately approved migration establishes provenance. Existing non-hub notes are
not imported by that relay.

Capacity is bounded by `GROK_MCP_MAX_ORIGINALS` (default 10000) and
`GROK_MCP_MAX_ORIGINAL_BYTES` (default 1073741824 bytes). Retained files, including partials,
count against limits. Limits pause new intake; they never delete originals. Existing
`GROK_MCP_MIN_FREE_BYTES` checks both inbox and audit filesystems. Valid replays remain
available at quota, but verify their original on each replay. Provision filesystem headroom
for metadata and temporary copies in addition to retained byte limits. No retention job.

The implementation assumes one service process owns the audit store, as before; do not
run multiple writers on the same directories. No new cross-process coordination is claimed.
Back up originals and committed audit records together. Rollback to older code after new
records exist requires compatibility review; do not remove the new metadata or originals
to force an older strict schema to load. Installation/restart, migration, ACLs, secrets,
backup/restore actions, publication and notifications require separate authorization.

Tests use isolated temporary directories only. Actual child processes are SIGKILLed at
nine persistence checkpoints; restart/retry and byte preservation are verified. These tests
exercise process loss, not power-loss behavior of a hypervisor or storage device.
