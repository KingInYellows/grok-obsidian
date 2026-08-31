# Project status

Reviewed 2026-08-31. This page separates recorded deployment evidence from fresh repository checks. It publishes no endpoint, account identity, private address, vault path, receipt identifier or recovery location. Detailed operator records remain local and excluded from Git.

## Implementation

The reference deployment uses Cloudflare Access Managed OAuth, a named Tunnel, an existing reverse proxy, a source-restricted relay and the loopback MCP origin. The origin independently validates the signed Access assertion, including its issuer, audience, subject and expiration. The selected internal HTTP hop is not encrypted; network restrictions and JWT verification do not provide transport encryption.

Only `submit_research_note` is enabled in that deployment. The reusable implementation also contains optional metadata-only `list_submissions`, which defaults to enabled. Set `GROK_MCP_ENABLE_LIST_SUBMISSIONS=false` for an intake-only endpoint. No tool reads vault notes, chooses paths, edits, deletes, fetches URLs or promotes research.

A restricted mount can expose only the dedicated inbox to the service while a separate identity owns the vault and synchronization credentials. Audit records remain outside the vault. This deployment arrangement is not installed by the package and requires its own permission and recovery review.

## Evidence and limits

| Area | Evidence | Limit |
| --- | --- | --- |
| Grok OAuth, discovery and intake | A private execution record dated 2026-08-31 documents authentication, exactly one tool, and one synthetic accepted submission with matching receipt and body hash | Reviewed existing evidence; not repeated during publication preparation |
| Sync and inbox isolation | Private acceptance records document a scoped mount, separate identities, server acknowledgement and local restart checks | Does not prove receipt on another client or full restore |
| Service status | Read-only inspection on 2026-08-31 found the MCP active/running | Liveness alone does not prove OAuth or successful intake |
| Checkout versus deployed application | The checkout's compiled JavaScript and declarations matched the deployed application during this review | Deployed TypeScript source files are older; use the checkout as the development source, not the installed source directory |
| Storage admission | Implementation checks available bytes on inbox and audit filesystems and rejects new submissions below the configured threshold | This is not a quota, reservation, retention policy or backup |
| OAuth renewal and reconnect | Not established by the first successful authenticated call | Requires a separately scoped client test |
| Another client, return edits and full restore | Not established by the reviewed evidence | Requires exact-file and isolated restore tests |
| Curator review and promotion | Deliberately outside the MCP | No automated promotion workflow is claimed |

An accepted receipt proves intake only. It does not establish factual accuracy, another client's receipt, curator approval or canonical promotion. `content_sha256` hashes the submitted UTF-8 body, not the full rendered Markdown file.

## Fresh local validation

On 2026-08-31, `npm run validate` exited 0 in the canonical Linux checkout: TypeScript type-check, all 22 synthetic tests and the production build passed. `git diff --check` also exited 0. No production candidate was submitted, and no service was restarted by this review.

## Repository state

At the initial publication review, GitHub was private and its only ref was `main` at the original import. The canonical checkout contained uncommitted implementation and documentation changes. The owner subsequently approved anonymizing the initial commit and committing/pushing the reviewed publication set. Changing visibility remains a separate decision.

The implementation changes include required JWT claims, candidate file permissions, storage admission checks, single-tool descriptions and regression tests. Public documentation now describes the observed deployment without publishing the operator's configuration. Private deployment scripts and records are retained locally, not included as reusable package components.

## Remaining work

- Verify the published branch, license and file inventory, and check residual access to the original commit before changing visibility.
- Keep private operator records and recovery material out of future commits. The owner approved publishing the MIT-licensed source; the initial commit email is anonymized as recorded below.
- Verify another client, OAuth renewal/reconnect and isolated recovery under separate test scopes.
- Define curator promotion, retention and backup ownership without expanding Grok's authority.

See [publication guidance](PUBLICATION.md) for the release boundary. This document authorizes no service, sync, account or vault changes.

## Approved email anonymization, 2026-08-31

The initial commit on local `main` is now `2e247a478721dc6132c0b29ed24c2eddac77c4b7`. Both author and committer email use the account-linked GitHub noreply address. The committed tree, names, timestamps and message are unchanged. The rewrite preserved the index and all 70 reviewed working files byte-for-byte before this documentation update.

A verified recovery bundle is retained privately and is not a publication input. Replacing the branch does not itself purge the original commit from GitHub caches or existing copies. Check the latest publication review before changing visibility; the original email remains in private recovery history until separately authorized cleanup.
