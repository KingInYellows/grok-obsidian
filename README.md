# Grok Obsidian MCP

Authenticated Grok-to-inbox submission passed a recorded live synthetic test on 2026-08-31. The reference deployment exposes only `submit_research_note`; a separate identity handles synchronization. Cross-client receipt, OAuth renewal, full recovery and curator promotion remain unverified or separate work. See [project status](docs/PROJECT-STATUS.md) for evidence and limits.

A locally runnable, security-scoped Streamable HTTP MCP server for accepting untrusted Grok research candidates. It writes only to one explicitly configured staging inbox. It has no vault browsing, note reading, editing, deletion, rename, promotion, arbitrary path, URL-fetch, database, or shell capability.

Hermes/Hali remains the curator. Grok can submit candidates and, when enabled, list metadata-only receipts for its own submissions. Hermes reviews, sanitizes, deduplicates, and separately authors or promotes canonical notes.

## Implemented boundary

- Binds to `127.0.0.1` only. The bind address is not configurable.
- Requires existing absolute staging-root, inbox, and audit directories.
- Requires the inbox and audit directories to be distinct children of the staging root.
- Rejects traversal, dot-prefixed configured paths, symlinks, junctions/reparse points, unexpected hardlinks, and unsafe generated basenames.
- Uses collision-resistant server-generated IDs and filenames. No tool accepts a filename or path.
- Publishes each note through exclusive temporary creation plus an atomic hardlink, then verifies a regular file with one link.
- Stores idempotency and listing metadata under the configured audit directory, never in the vault note or tool response.
- Defaults to Cloudflare Access authentication and fails startup until its team domain, audience, and allowed tunnel hostname are configured.
- Allows unauthenticated local testing only when `GROK_MCP_AUTH_MODE=local-development` is explicitly set. That mode rejects proxy-shaped requests.
- Validates `Cf-Access-Jwt-Assertion` signature, issuer, audience, subject, and required expiration in Cloudflare Access mode. The stored owner is a pseudonym, not the raw identity.
- Validates `Host` and, when present, `Origin`; limits request, research-body, rendered-note, list-page, and request-rate sizes.

## Tools

### `submit_research_note`

Accepts `title`, `body_markdown`, `idempotency_key`, and optional `source_urls` and `topic`. It creates one immutable candidate with server-owned frontmatter and returns only `note_id`, `submitted_at`, `status`, and `content_sha256`.

### `list_submissions`

Available in the reusable implementation, but disabled for the approved public deployment with `GROK_MCP_ENABLE_LIST_SUBMISSIONS=false`. It reads only service-owned audit records for the authenticated subject. It returns receipt metadata, title, and optional topic. It never reads the inbox or returns bodies, source URLs, paths, filenames, owner identifiers, or idempotency keys.

## Local launch

Node.js 22 or newer is required. Create a synthetic staging fixture or the user-selected real staging directories first. Do not point this service at a whole vault.

PowerShell example using placeholder paths:

```powershell
$env:GROK_MCP_STAGING_ROOT = 'C:\path\to\grok-staging'
$env:GROK_MCP_INBOX_DIR = 'C:\path\to\grok-staging\Grok Research Inbox'
$env:GROK_MCP_AUDIT_DIR = 'C:\path\to\grok-staging\service-audit'
$env:GROK_MCP_AUTH_MODE = 'local-development'
npm ci
npm run build
npm start
```

The server reports a sanitized startup event and listens at `http://127.0.0.1:3100/mcp`. Local-development mode is only for a loopback smoke test. Never connect a Tunnel while that mode is active.

## Validation

Use Node.js 22 or newer and native dependencies in your own checkout:

```sh
npm ci
npm run validate
```

Do not share dependencies or build outputs between Windows and Linux. Keep developer builds separate from the installed service; building this project does not deploy it.

The suite covers configuration escape, traversal-shaped input, strict schemas, bad URLs, frontmatter metadata injection, UTF-8 byte limits, oversized HTTP requests, symlink/reparse paths, hardlinked audit records, atomic collision handling, concurrent idempotency, metadata redaction, Origin rejection, Access identity pseudonymization, and a real local MCP client/server exchange.

## Documentation

- [Current status and evidence limits](docs/PROJECT-STATUS.md)
- [Configuration and local operation](docs/CONFIGURATION.md)
- [Cloudflare and Grok setup reference](docs/CLOUDFLARE-GROK-SETUP.md)
- [Security boundary](SECURITY.md)
- [Design records](outputs/README.md)
- [Publication checklist](docs/PUBLICATION.md)

No Cloudflare Tunnel, Access application, Grok connector, credential, or live vault access is created by this repository. Host addresses, operator runbooks, recovery locations and personal automation records are deliberately excluded.

## License

[MIT](LICENSE). The package remains `private: true` to prevent accidental npm publication; that setting is independent of GitHub repository visibility.
