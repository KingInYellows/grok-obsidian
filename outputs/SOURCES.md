# Primary-source registry

> Historical planning record from 2026-08-29. These original assumptions and questions are not the current deployment status or a new authorization request. See [project status](../docs/PROJECT-STATUS.md) for recorded acceptance and remaining checks.

Research date: 2026-08-29. These sources were consulted for planning only; no linked service was configured or accessed as an account holder.

| Topic | Primary source | Planning use |
| --- | --- | --- |
| Grok custom connectors | [xAI: Connectors](https://docs.x.ai/grok/connectors) | Confirms custom MCP connector URL entry, tool discovery, public reachability, and completion of required authentication. |
| Local public reachability and Cloudflare quick tunnels | [xAI: Custom MCP Server Tunneling](https://docs.x.ai/grok/connectors/custom-mcp-tunneling) | Confirms private/localhost URLs are rejected; quick tunnels have temporary URLs and do not support SSE; Streamable HTTP works with them. |
| xAI Remote MCP tool parameters | [xAI: Remote MCP Tools](https://docs.x.ai/developers/tools/remote-mcp) | Confirms Streaming HTTP/SSE support, authorization/header fields, and explicit tool allowlists for API-based remote MCP use. |
| Grok Build local development | [xAI: Grok Build overview](https://docs.x.ai/build/overview) | Separates local developer tooling from the cloud-app custom connector path. |
| Grok business connector administration | [xAI: Connector Management](https://docs.x.ai/grok/connector-management) | Confirms Business/Enterprise custom-connector administration requires an authorized team administrator. |
| MCP transport security | [Model Context Protocol: Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) | Supports Streamable HTTP, `Origin` validation, loopback binding for local servers, and authentication. |
| MCP TypeScript server guidance | [MCP TypeScript SDK: Server](https://ts.sdk.modelcontextprotocol.io/server) | Identifies Streamable HTTP as the recommended remote transport and notes stateless-server support. |
| Cloudflare Tunnel boundary | [Cloudflare: Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) | Confirms `cloudflared` uses outbound-only connections and that a Tunnel avoids a publicly routable origin IP; it is not authorization. |
| Cloudflare managed MCP authorization | [Cloudflare: Authorization for MCP](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/) | Describes OAuth 2.1 and Cloudflare Access or third-party authorization options for MCP servers. |
| Cloudflare Access Managed OAuth | [Cloudflare: Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) | Supports the approval-gated Managed OAuth design and the requirement to validate Access tokens at the origin. |
| Cloudflare secure MCP cautions | [Cloudflare: Secure MCP servers](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/) | Distinguishes server-managed OAuth from Cloudflare Access configuration and warns to enable Managed OAuth only when the server validates the Access JWT. |
| Cloudflare internal-service pattern | [Cloudflare: Connect your internal network services](https://developers.cloudflare.com/use-cases/apis/internal-services/) | Supports publishing a narrowly scoped internal service rather than the vault itself. |
| Obsidian Sync security model | [Obsidian: Security and privacy](https://help.obsidian.md/Obsidian%20Sync/Security%20and%20privacy) | Documents encrypted remote vaults and end-to-end encryption; supports the conclusion that a cloud MCP service should not presume direct write access to Sync. |
| Obsidian Sync history and collaboration | [Obsidian: Version history](https://help.obsidian.md/Obsidian%2BSync/Version%2Bhistory) | Documents sync/version history and shared-vault collaboration context, relevant to recovery and curator review. |

## Evidence limitations

- xAI documents that custom connector users complete required authentication, but the reviewed custom-connector pages do not specify every browser OAuth compatibility detail. The plan therefore requires a mock proof before enabling Cloudflare Access Managed OAuth and forbids a public/shared-static-token fallback.
- The reviewed Obsidian material documents Sync as synchronization rather than a public external write API. This package makes no claim that such an API does not exist; it only declines to depend on one without official, current documentation and user approval.
- Cloudflare product behavior, xAI connector UX, and protocol versions can change. Recheck these primary sources during the approved implementation phase.
