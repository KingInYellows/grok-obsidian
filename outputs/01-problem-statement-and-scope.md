# Problem statement and scope

> Historical planning record from 2026-08-29. These original assumptions and questions are not the current deployment status or a new authorization request. See [project status](../docs/PROJECT-STATUS.md) for recorded acceptance and remaining checks.

## Problem

Research created in the cloud Grok app needs a reliable landing place near a shared Obsidian vault without making the vault a general-purpose tool target. A connector that accepts arbitrary filesystem paths, exposes directory listing, or lets Grok edit existing notes would turn a one-way intake need into broad vault access. That is outside the intended trust boundary.

The desired outcome is a one-way submission lane:

```text
Grok conversation -> constrained MCP tool -> fixed staging inbox -> Hermes review -> curated vault
```

The connector is an intake mechanism, not a vault-management API and not an automation authority for Hermes.

## In scope

- A custom remote MCP server that the cloud Grok app can reach over HTTPS.
- Creation of Markdown research candidates into a single preselected staging inbox, preferably outside the canonical vault.
- An optional, ownership-scoped history view for notes created through that connector.
- Provenance, idempotency, rate limits, audit metadata, and a curator workflow.
- A comparison of tunnel-backed local storage, cloud-hosted canonical intake, and direct connector approaches.
- A plan to validate the selected design before it touches a real vault or account.

## Explicitly out of scope

- Reading any existing vault note, folder, attachment, metadata, index, database, or configuration.
- Arbitrary file operations, path selection, search, rename, delete, move, tag management, task completion, or promotion.
- Shell execution, arbitrary HTTP fetching, browser control, databases exposed as MCP tools, Git operations, plugin installation, and vault-wide indexing.
- Collecting Grok, Cloudflare, Obsidian, or tunnel credentials.
- Automated promotion. Hermes owns review and promotion decisions.

## Assumptions and unknowns

| Item | Status | Consequence |
| --- | --- | --- |
| The actual vault location, operating system owner, sync method, and directory conventions | Deliberately uninspected | No deployment path or sync claim is made. |
| Grok can add a custom MCP connector by public URL | Verified from xAI documentation | A remote endpoint is required. |
| Grok custom-connector UI can complete the chosen OAuth/Cloudflare Access flow | Unknown | Prove this with a harmless mock server before enabling Managed OAuth. Do not use a public or shared-static-token fallback. |
| The user has a Cloudflare account/domain or wants one | Unknown | The no-tunnel option can use Workers after separate approval; local tunneling needs a named Tunnel for a stable production URL. |
| Obsidian Sync provides a supported external write API | Not established | Do not target Obsidian Sync as an MCP write API. Its documented role is client vault synchronization, with optional end-to-end encryption. |

## Security properties to preserve

1. Capability confinement: a Grok tool call can create at most one new staging candidate or list its submission metadata.
2. Spatial confinement: a note can only appear under the server-owned inbox root; caller-supplied text cannot influence a filesystem path.
3. Temporal confinement: access tokens are short-lived where supported; duplicate requests do not create duplicate notes.
4. Information confinement: no tool returns unrelated vault content, configuration, logs, or secrets.
5. Curator separation: only Hermes can promote research into the main knowledge base.
