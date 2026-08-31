# Design records

These reviewed documents explain the intake boundary and preserve the original design reasoning. Start with [current project status](../docs/PROJECT-STATUS.md). Historical questions and proposed controls are not proof of implementation or authorization to change a deployment.

1. [Problem statement and scope](01-problem-statement-and-scope.md)
2. [Threat model](02-threat-model.md)
3. [Architecture decision](03-architecture-decision-record.md)
4. [MCP contract and schema](04-mcp-contract-and-schema.md)
5. [Operations and acceptance plan](05-operations-and-acceptance.md)
6. [Original decision questions](06-decision-questions.md)
7. [Primary-source registry](SOURCES.md)
8. [Original implementation evidence](IMPLEMENTATION-READINESS.md)

Host-specific runbooks, execution receipts, private network details, recovery paths, vault inventory and personal automation records are preserved locally and excluded from publication. Do not force-add those records to Git. `.gitignore` does not remove content already present in Git history.

The reference deployment exposes only `submit_research_note`. Optional `list_submissions` reads service-owned receipt metadata only. Neither tool reads vault notes, chooses paths, changes configuration, fetches URLs, or promotes research. Curator review and promotion remain separate authority.
