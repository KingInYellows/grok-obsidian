# ADR-001: choose the research intake topology

The reference deployment uses Option A. Recorded acceptance on 2026-08-31 covers Managed OAuth, single-tool discovery and one durable synthetic candidate. See [project status](../docs/PROJECT-STATUS.md) for evidence and limits. Earlier compatibility gates below describe the requirements for a new installation, not an unresolved first-connection test on the reference deployment.

The landing host exposes only its fixed inbox mount to the MCP. Audit records remain outside the vault, and a separate sync identity holds the vault credentials. Curator promotion is not implemented by this service.

## Decision drivers

- Grok needs a public HTTPS MCP endpoint. xAI documents that custom MCP servers must be publicly reachable; private and localhost URLs are rejected.
- The endpoint must use Streamable HTTP rather than the deprecated HTTP+SSE transport. xAI states that its remote MCP tooling supports Streaming HTTP and SSE, while its Cloudflare quick-tunnel guidance says quick tunnels do not support SSE and newer Streamable HTTP works.
- Grok Build can use local stdio for developer testing, but it is not a route for the cloud Grok app. The cloud application needs the public HTTPS endpoint above.
- The system must avoid any capability that reads or manages the broader vault.
- Hermes must retain promotion authority.

## Options

| Option | Flow | Tunnel | Security and operations | Fit |
| --- | --- | --- | --- | --- |
| A. Local staging MCP through named Cloudflare Tunnel | Grok -> Access/Tunnel -> reverse proxy -> source-restricted relay -> loopback MCP service -> fixed staging inbox -> Hermes -> canonical vault note | Yes | Near-immediate candidate delivery. The service runs near the vault but receives access only to the staging folder, mapped only to the dedicated vault inbox. It needs strict path defenses, host uptime, Access JWT validation, patching, and monitoring. | Recommended shared-vault design. |
| B. Cloud intake, local importer | Grok -> Worker MCP -> R2 private intake -> Hermes-controlled local importer -> staging inbox -> canonical vault note | No | The public service never has vault access. The local machine makes an outbound pull and writes one fixed folder. Adds bounded delivery delay and a durable queue. | Valid isolated alternative when tunnel avoidance outweighs the extra importer. |
| C. Cloud canonical Markdown store with client sync | Grok -> Worker MCP -> cloud object store/repository -> sync client -> vault | No | Can remove the local public endpoint, but changes who is canonical and makes conflict/recovery and sync semantics central. | Viable only if the user deliberately chooses the cloud store as canonical for this inbox. |
| D. Direct third-party connector | Grok -> provider connector/API -> a cloud folder/repository that a local vault sync consumes | Usually no | May avoid custom MCP hosting, but a provider connector's scope, write semantics, access model, and sync behavior determine the boundary. It is not automatically an Obsidian solution. | Research candidate, not a default. |

## Recommendation

Choose Option A. Use a named, not quick, Cloudflare Tunnel for a stable hostname. Run the origin on loopback only, publish only `/mcp`, and write only to a fixed staging inbox. The operating-system account must lack access to the canonical vault and every other user directory where practical. Hermes performs the separate review, sanitization, deduplication, and promotion action that authors a canonical vault note.

The approved deployment maps only the fixed staging inbox to `Grok Research Inbox` in the reference vault. Bidirectional Headless Sync uploads these candidates. Vault-root permissions remain unchanged, and service audit data remains outside the vault. A server acknowledgement and local restart proof do not establish receipt on another client or Hermes promotion.

Cloudflare Tunnel uses outbound-only origin connections, which avoids opening an inbound port, but it does not replace MCP authorization. Enable Cloudflare Access Managed OAuth only if the exact Grok custom-connector flow completes the standard authorization exchange in a harmless test and the origin validates the Access JWT. If that proof fails, stop for a user decision; do not make the endpoint public or substitute a shared static token.

Option B removes the Tunnel because Grok reaches a Worker directly. It does not make Obsidian Sync a server API and does not expose the vault to the cloud service. Its trade-off is an approved, operated importer/sync component and eventual delivery.

## Authentication choices

| Choice | Suitable when | Constraints |
| --- | --- | --- |
| Cloudflare Access Managed OAuth | Grok custom connector completes the standard OAuth flow and the origin can validate Access JWTs | Recommended after a harmless compatibility proof. Provides user binding and revocation. |
| OAuth compatibility failure | Grok cannot complete the selected Access flow | Stop and bring the result to the user. Reconsider the topology or connector surface; do not fall back to an unauthenticated endpoint or shared static token. |

The custom Grok connector documentation says the user enters a server URL and completes required authentication, but it does not describe the exact browser OAuth details needed for this topology. That documentation gap originally required an approval-gated compatibility proof. The recorded live acceptance summarized above establishes the selected connector flow; renewal/reconnect remains a separate check.

## Why Obsidian Sync is not the MCP storage endpoint

Obsidian documents Sync as encrypted synchronization between local and remote vaults, with version history and shared-vault collaboration support. The official material reviewed here does not establish a supported external write API for an MCP server. With end-to-end encryption, a remote service without the encryption secret cannot safely create vault records. Treat Sync as a client synchronization layer, not as a direct Grok target.

## Viable direct connector candidates to investigate after selection

1. A Worker MCP service with R2 intake and a local importer, Option B. This is the no-tunnel alternative because its cloud credential cannot read the vault.
2. A dedicated Git repository containing only the inbox, with a local approved Git-based import process. A GitHub App could be scoped to one repository, but this adds repository and sync semantics. Do not give Grok a repository-wide tool set.
3. A cloud drive folder with a vendor API that supports writing a file only into that folder, followed by a local sync/import process. This needs a provider-specific review of OAuth scopes, path confinement, and conflict behavior.

No candidate should send connector credentials to an Obsidian Sync vault or rely on an undocumented Obsidian cloud write interface.

## Revisit triggers

- The vault connection is proven and establishes the actual storage, sync, identity, and curation requirements.
- Grok's connector documentation adds or changes OAuth, headers, approval, or transport rules.
- The user requires near-real-time delivery, multi-user attribution, attachments, or source retrieval.
- A request proposes any new tool that reads, moves, edits, or deletes notes.

## Deployment outcome, reviewed 2026-08-31

The reference installation uses the existing Tunnel and reverse proxy, a source-restricted HTTP relay, and a loopback MCP. Managed OAuth and a single synthetic authenticated submission are recorded as passed. The internal HTTP hop is unencrypted. No actual hostname, address, account, vault path or recovery location is part of this public record.

An inbox-only mount and a separate sync identity permit candidate upload without giving the MCP the broader vault or sync credentials. Public discovery exposes only `submit_research_note`; the optional metadata listing is disabled in server configuration.

Cross-client receipt, OAuth renewal/reconnect, full restore and curator promotion remain separate work. Earlier alternate-writer and pull-only proposals were not the final deployed choice. Private operator history is retained outside the publication set.
