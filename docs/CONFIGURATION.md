# Configuration and local operation

The server reads configuration from environment variables and creates no staging root, inbox, or top-level audit directory. All three must exist before startup. This prevents a typo from silently creating a new intake location.

## Required variables

| Variable | Meaning |
| --- | --- |
| `GROK_MCP_STAGING_ROOT` | Existing absolute directory that bounds all service writes. |
| `GROK_MCP_INBOX_DIR` | Existing fixed candidate directory strictly inside the staging root. |
| `GROK_MCP_AUDIT_DIR` | Existing service-metadata directory strictly inside the staging root and outside the inbox. |
| `GROK_MCP_AUTH_MODE` | `cloudflare-access` for a protected tunnel, or explicit `local-development` for loopback smoke tests. Defaults to `cloudflare-access`. |

Cloudflare Access mode also requires:

| Variable | Meaning |
| --- | --- |
| `GROK_MCP_ACCESS_TEAM_DOMAIN` | Exact team origin such as `https://your-team.cloudflareaccess.com`. |
| `GROK_MCP_ACCESS_AUD` | Application Audience tag for the Access application. |
| `GROK_MCP_ALLOWED_HOSTS` | Comma-separated hostnames accepted at the origin, including the public tunnel hostname. Do not include schemes or paths. |

`GROK_MCP_ACCESS_AUD` is an identifier, not a shared authentication secret. Do not put Access assertions, tunnel credentials, API tokens, client secrets, or vault content in repository files.

## Optional bounded settings

| Variable | Default | Limit |
| --- | ---: | ---: |
| `GROK_MCP_PORT` | `3100` | 1 to 65535 |
| `GROK_MCP_MAX_REQUEST_BYTES` | `131072` | 16 KiB to 1 MiB |
| `GROK_MCP_MAX_RESEARCH_BYTES` | `50000` | 1 KiB to 50,000 bytes |
| `GROK_MCP_MAX_NOTE_BYTES` | `65536` | 8 KiB to 128 KiB |
| `GROK_MCP_MIN_FREE_BYTES` | `1073741824` (1 GiB) | 1 to 9007199254740991 bytes |
| `GROK_MCP_REQUESTS_PER_MINUTE` | `120` | 1 to 10,000 per authenticated subject |
| `GROK_MCP_ENABLE_LIST_SUBMISSIONS` | `true` | `true` or `false` |
| `GROK_MCP_ALLOWED_ORIGINS` | empty | Exact comma-separated HTTPS origins. Any supplied `Origin` is rejected unless listed. |

## Safe local smoke test

1. Choose a synthetic directory that is not an Obsidian vault.
2. Create the staging root, inbox, and audit directory yourself.
3. Set the three absolute path variables and `GROK_MCP_AUTH_MODE=local-development` in the current shell.
4. Run `npm ci`, `npm run build`, and `npm start`.
5. Connect an MCP client to `http://127.0.0.1:3100/mcp`.
6. Stop the server before changing authentication or exposing any route.

The process never binds to `0.0.0.0` or `::`. Local-development mode rejects Cloudflare and forwarded-client headers to reduce the chance of accidentally tunneling an unauthenticated local instance.

The staging filesystem must support creation of hardlinks within the inbox directory. The server uses a temporary file plus an exclusive hardlink to publish a complete note atomically without overwriting an existing name. NTFS and common Linux filesystems support this; validate the selected network or removable filesystem before deployment.

## Low-privilege service account

Before real staging is selected, create a dedicated OS identity and grant it only the permissions needed to create files in the selected inbox and records under the audit directory. Deny or omit access to the canonical vault, user profile, SSH keys, browser data, and other repositories. The included systemd unit is a template; its placeholder paths and account must be replaced during an authorized setup.


## Optional candidate permissions for a separate sync identity

`GROK_MCP_NOTE_FILE_MODE` accepts only `0600` or `0640`, defaulting to `0600`.
The opt-in `0640` mode applies only to candidate files through descriptor-based
chmod, including under `UMask=0077`. Audit records remain `0600`. A dedicated
setgid inbox group and the isolated service bind provide read access to the
sync identity without exposing audit records or the vault root to Grok.

Before enabling group-readable candidates, the sync wrapper must reject the
`unsupported` file type so transient `.partial` files are not uploaded. Config
syncing remains disabled. Changing this setting does not itself configure a
mount, grant group access, change sync mode, or enable the permanent service.


A deployment may use an inbox-only group or narrowly scoped default ACL to give a separate sync identity read access to candidates. Do not grant that identity access to service audit records or give the MCP access to the rest of the vault. Configure and validate these permissions separately; no host-specific ACL or mount is installed by this package.

## Storage admission safeguard

Before each new submission, within the store's serialized operation, the server
checks available bytes for both the inbox and audit filesystems using `statfs`
blocks available to the service identity. If either is below
`GROK_MCP_MIN_FREE_BYTES`, or the check fails, no submission files are created and
the tool returns a sanitized retryable failure. Matching idempotent replays still
return the original receipt without requiring free space.

This is an admission threshold, not a filesystem quota or a reservation: other
writers can consume space after the check, and an accepted write can cross the
threshold. Write failures clean up files created by that attempt; existing
exclusive-create collisions are preserved. Retain backups and capacity planning.
