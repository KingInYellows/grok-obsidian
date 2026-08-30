# ADR-001: choose the research intake topology

Status: proposed. Decision deferred pending user answers and a harmless authentication compatibility proof.

## Decision drivers

- Grok needs a public HTTPS MCP endpoint. xAI documents that custom MCP servers must be publicly reachable; private and localhost URLs are rejected.
- The endpoint must use Streamable HTTP rather than the deprecated HTTP+SSE transport. xAI states that its remote MCP tooling supports Streaming HTTP and SSE, while its Cloudflare quick-tunnel guidance says quick tunnels do not support SSE and newer Streamable HTTP works.
- Grok Build can use local stdio for developer testing, but it is not a route for the cloud Grok app. The cloud application needs the public HTTPS endpoint above.
- The system must avoid any capability that reads or manages the broader vault.
- Hermes must retain promotion authority.

## Options

| Option | Flow | Tunnel | Security and operations | Fit |
| --- | --- | --- | --- | --- |
| A. Local staging MCP through named Cloudflare Tunnel | Grok -> HTTPS Tunnel -> `127.0.0.1` MCP service -> fixed staging inbox -> Hermes -> canonical vault note | Yes | Near-immediate candidate delivery. The service runs near the vault but receives access only to the staging folder, ideally outside the vault. It needs strict path defenses, host uptime, Access JWT validation, patching, and monitoring. | Recommended shared-vault design. |
| B. Cloud intake, local importer | Grok -> Worker MCP -> R2 private intake -> Hermes-controlled local importer -> staging inbox -> canonical vault note | No | The public service never has vault access. The local machine makes an outbound pull and writes one fixed folder. Adds bounded delivery delay and a durable queue. | Valid isolated alternative when tunnel avoidance outweighs the extra importer. |
| C. Cloud canonical Markdown store with client sync | Grok -> Worker MCP -> cloud object store/repository -> sync client -> vault | No | Can remove the local public endpoint, but changes who is canonical and makes conflict/recovery and sync semantics central. | Viable only if the user deliberately chooses the cloud store as canonical for this inbox. |
| D. Direct third-party connector | Grok -> provider connector/API -> a cloud folder/repository that a local vault sync consumes | Usually no | May avoid custom MCP hosting, but a provider connector's scope, write semantics, access model, and sync behavior determine the boundary. It is not automatically an Obsidian solution. | Research candidate, not a default. |

## Recommendation

Choose Option A. Use a named, not quick, Cloudflare Tunnel for a stable hostname. Run the origin on loopback only, publish only `/mcp`, and write only to a fixed staging inbox. The operating-system account must lack access to the canonical vault and every other user directory where practical. Hermes performs the separate review, sanitization, deduplication, and promotion action that authors a canonical vault note.

Cloudflare Tunnel uses outbound-only origin connections, which avoids opening an inbound port, but it does not replace MCP authorization. Enable Cloudflare Access Managed OAuth only if the exact Grok custom-connector flow completes the standard authorization exchange in a harmless test and the origin validates the Access JWT. If that proof fails, stop for a user decision; do not make the endpoint public or substitute a shared static token.

Option B removes the Tunnel because Grok reaches a Worker directly. It does not make Obsidian Sync a server API and does not expose the vault to the cloud service. Its trade-off is an approved, operated importer/sync component and eventual delivery.

## Authentication choices

| Choice | Suitable when | Constraints |
| --- | --- | --- |
| Cloudflare Access Managed OAuth | Grok custom connector completes the standard OAuth flow and the origin can validate Access JWTs | Recommended after a harmless compatibility proof. Provides user binding and revocation. |
| OAuth compatibility failure | Grok cannot complete the selected Access flow | Stop and bring the result to the user. Reconsider the topology or connector surface; do not fall back to an unauthenticated endpoint or shared static token. |

The custom Grok connector documentation says the user enters a server URL and completes required authentication, but it does not describe the exact browser OAuth details needed for this topology. Therefore Managed OAuth is a preferred design, not yet a verified compatibility claim. A mock server proof is an approval-gated prerequisite.

## Why Obsidian Sync is not the MCP storage endpoint

Obsidian documents Sync as encrypted synchronization between local and remote vaults, with version history and shared-vault collaboration support. The official material reviewed here does not establish a supported external write API for an MCP server. With end-to-end encryption, a remote service without the encryption secret cannot safely create vault records. Treat Sync as a client synchronization layer, not as a direct Grok target.

## Viable direct connector candidates to investigate after selection

1. A Worker MCP service with R2 intake and a local importer, Option B. This is the no-tunnel alternative because its cloud credential cannot read the vault.
2. A dedicated Git repository containing only the inbox, with a local approved Git-based import process. A GitHub App could be scoped to one repository, but this adds repository and sync semantics. Do not give Grok a repository-wide tool set.
3. A cloud drive folder with a vendor API that supports writing a file only into that folder, followed by a local sync/import process. This needs a provider-specific review of OAuth scopes, path confinement, and conflict behavior.

No candidate should send connector credentials to an Obsidian Sync vault or rely on an undocumented Obsidian cloud write interface.

## Revisit triggers

- Grok's connector documentation adds or changes OAuth, headers, approval, or transport rules.
- The user requires near-real-time delivery, multi-user attribution, attachments, or source retrieval.
- A request proposes any new tool that reads, moves, edits, or deletes notes.
