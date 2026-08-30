# Security boundary

This server is an intake-only component for untrusted external research. Its authority ends at one configured staging inbox.

## Exposed capabilities

- `submit_research_note` creates one new server-named candidate.
- `list_submissions`, when enabled, returns metadata-only records owned by the authenticated subject.

There are no MCP resources or prompts. There are no tools for reading notes, browsing directories, choosing paths, overwriting, editing, renaming, deleting, promoting, fetching URLs, running shell commands, querying databases, or changing configuration.

## Runtime assumptions

- Run under a dedicated low-privilege OS account.
- Give that account write access only to the staging inbox and service audit directory. Do not grant it access to the canonical vault.
- Prefer a staging root outside the canonical Obsidian vault. If a folder inside a vault is deliberately selected later, its permissions must still exclude every sibling and parent capability.
- Keep the origin bound to `127.0.0.1`. A named Cloudflare Tunnel may later publish only `/mcp`.
- A Tunnel provides reachability, not authentication. Before any tunnel is connected, configure Cloudflare Access Managed OAuth and set this service to `cloudflare-access` mode so it validates the Access JWT.
- If the exact Grok connector cannot complete the harmless Managed OAuth compatibility proof, stop. Do not make the endpoint public and do not substitute a shared static token.

## Content handling

Research bodies and source URLs are stored as untrusted data. The service does not fetch URLs, execute Markdown, render templates, or interpret note text as instructions. Hermes/Hali must sanitize and deduplicate a candidate before creating or promoting a canonical note.

Logs contain event names, tool names, and error classes only. They must not contain request bodies, source URLs, authorization headers, raw identities, secrets, or configured filesystem paths.

## Reporting

Do not include a real vault sample, private note body, token, Access assertion, tunnel credential, or `.env` file in an issue. Reproduce problems with synthetic temporary directories and synthetic content.
