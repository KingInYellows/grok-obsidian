# Cloudflare and Grok setup reference

The reference deployment passed a recorded authenticated Grok submission on 2026-08-31. See [project status](PROJECT-STATUS.md) for evidence and limits. This guide describes a new deployment; it is not permission to repeat setup on an existing installation.

## Request path

The reference topology is Grok over public HTTPS -> Cloudflare Access Managed OAuth -> named Tunnel -> existing reverse proxy -> source-restricted relay -> MCP at `127.0.0.1:3100`.

The MCP independently validates the signed `Cf-Access-Jwt-Assertion`. Preserve the public Host header through the proxy and allow it explicitly in server configuration. Any LAN relay must be restricted to the intended proxy source and must not turn the loopback service into a generally reachable origin. A private HTTP hop is unencrypted; choose and test its transport protection for your network.

Use your own hostname, such as `research.example.com`, and keep actual addresses, allowed identities and credentials in protected operator configuration. The included Tunnel file contains placeholders only. Preserve existing ingress ordering and unrelated routes when adapting it. Managed OAuth discovery and login are handled at the edge, not by adding unauthenticated routes to this server.

## Acceptance sequence

1. Configure Access Managed OAuth and origin JWT validation before enabling ingress. Keep authentication in `cloudflare-access` mode. Set `GROK_MCP_ENABLE_LIST_SUBMISSIONS=false` for an intake-only endpoint.
2. Verify missing, expired and invalid assertions are rejected. Test Host/Origin handling and the proxy source restrictions. Do not assume a reachable URL is authenticated.
3. Add your approved `https://research.example.com/mcp` URL to the Grok custom connector and complete sign-in. Verify discovery exposes exactly `submit_research_note` for the intake-only profile.
4. Submit one synthetic candidate with a stable idempotency key. An identical retry must return the original receipt; changed content with the same key must be rejected. Verify the candidate and receipt without reading unrelated notes.
5. Check receipt on the intended second client separately. Test renewal, reconnect and recovery within an explicit scope before relying on unattended operation.
6. If scheduling research, require one stable key per logical item/run and require the job to report authentication or intake failures. A saved schedule does not establish a successful scheduled submission.

Never expose local-development mode, substitute a shared static token, use a quick Tunnel for durable service, or grant Grok broader vault access. Keep tokens, assertions, private research and raw authentication logs out of Git and test reports.

The [official connector guide](https://docs.x.ai/grok/connectors) and [Cloudflare Managed OAuth documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) describe provider setup. Recheck them when configuring a new deployment; a successful test on the reference installation does not prove compatibility for every client or account.
