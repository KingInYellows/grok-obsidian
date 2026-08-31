# Decision questions for the user

> Historical planning record from 2026-08-29. These original assumptions and questions are not the current deployment status or a new authorization request. See [project status](../docs/PROJECT-STATUS.md) for recorded acceptance and remaining checks.

Please answer these before implementation or account setup begins.

1. Do you approve the recommended topology: a localhost-only Streamable-HTTP MCP service behind a named Cloudflare Tunnel, writing candidates only to a fixed staging inbox outside the canonical vault where practical?
2. Is bounded eventual delivery acceptable instead? If yes, Option B, a Worker plus R2 intake and separate local importer, removes the Tunnel but adds a sync/import component.
3. Is this a single-user connector or must it attribute multiple Grok users separately? This determines whether individual OAuth identities are required.
4. Which Grok surface will use the connector: grok.com custom connector, a Business/Enterprise team connector, or xAI API Remote MCP tools? The API supports explicit authorization/header and allowlist parameters; the custom UI's exact authentication compatibility still needs a proof.
5. May a harmless mock MCP endpoint be added to the chosen Grok surface solely to prove Cloudflare Access Managed OAuth and origin JWT validation? No real vault content would be used.
6. Do you want an immutable cloud intake queue, and how long should it retain original submissions and redacted audit metadata?
7. Should `list_submissions` exist at launch? Removing it yields the smallest boundary. If retained, it will return metadata only, with no content preview.
8. What content limits are acceptable: maximum note bytes, maximum source URLs, and daily submission quota?
9. Should source URLs be stored as plain provenance only, or should any later trusted curator workflow fetch and validate them? The MCP server should never fetch them.
10. What is the precise fixed staging inbox name and intended curator handling rule? The default is `Grok Research Inbox` with `status: inbox` frontmatter, no auto-promotion, and Hermes-authored canonical notes.
11. If Option A is chosen, is a stable Cloudflare hostname and an always-on local host acceptable? A quick Tunnel is unsuitable for durable use because its URL changes after restart.
12. May a local service account be created later with write access limited to the staging folder and no access to the canonical vault? This is required for Option A and the local importer in Option B.

## Recommended initial selection

Option A, single user, metadata-only `list_submissions`, Cloudflare Access Managed OAuth only if a mock proof succeeds, no public or shared-static-token fallback, a fixed staging inbox outside the canonical vault, and a 50 KB candidate cap. Do not proceed from this recommendation without answers and explicit approval.
