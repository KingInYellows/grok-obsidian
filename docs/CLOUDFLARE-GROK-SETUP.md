# Later Cloudflare and Grok setup

This is a runbook for later user-authorized work. Nothing in the implementation task performs these actions.

## Stop gates

- Do not create or connect a Tunnel while `GROK_MCP_AUTH_MODE=local-development`.
- Do not expose the service until Cloudflare Access Managed OAuth is configured and the origin has the matching team domain, audience, and allowed hostname.
- Do not register the real connector until a harmless synthetic compatibility proof succeeds.
- If Grok cannot complete the Managed OAuth flow, stop for a design decision. Do not use public access or a shared static token.

## Remaining user actions

1. Choose or create the actual staging root and `Grok Research Inbox`. Prefer a location outside the canonical vault. Create a separate audit directory under the same staging root.
2. Create or select the low-privilege OS account. Give it write access only to the inbox and audit directories.
3. Put runtime environment values in the host's protected service configuration. Set `GROK_MCP_AUTH_MODE=cloudflare-access`, the Access team domain, the Access application audience, and the intended MCP hostname in `GROK_MCP_ALLOWED_HOSTS`.
4. Build and run the service locally. Confirm it listens only on `127.0.0.1` and refuses requests without a valid synthetic Access assertion once Access mode is enabled.
5. Create a durable named Cloudflare Tunnel and an Access application for the MCP hostname. Enable Managed OAuth. A quick Tunnel is not the durable design.
6. Configure the named Tunnel to send only the exact MCP route to `http://127.0.0.1:3100`; return a Cloudflare 404 for all fallback ingress.
7. Run a harmless connector proof with synthetic content. Confirm the standard OAuth browser flow completes, the origin validates `Cf-Access-Jwt-Assertion`, and only `submit_research_note` plus optional `list_submissions` are discovered.
8. Register `https://mcp.example.com/mcp` as the Grok custom MCP URL, replacing the placeholder hostname. Where Grok exposes a tool allowlist, select only the two server tools.
9. Submit one synthetic candidate and verify that Hermes/Hali can review it without granting Grok any canonical-vault capability.

## Origin JWT validation already implemented

In `cloudflare-access` mode, the server obtains Cloudflare's rotating public signing keys from the configured team domain and validates the JWT signature, `iss`, `aud`, and `sub` claims from `Cf-Access-Jwt-Assertion`. It records only a SHA-256-derived subject pseudonym. Raw Access identity and JWT data are neither stored nor logged.

The JWKS request is made only at runtime when Access authentication is actually configured and a request needs validation. No Cloudflare call occurs in local-development mode.
