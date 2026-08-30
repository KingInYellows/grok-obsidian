import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { InputError, RateLimitError } from "./errors.js";
import {
  listSubmissionsSchema,
  receiptSchema,
  submissionPageSchema,
  submitResearchNoteSchema,
} from "./schema.js";
import { SubmissionStore } from "./storage.js";
import type { AppConfig, RequestIdentity, SubmissionInput } from "./types.js";

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

function publicToolFailure(error: unknown, tool: string) {
  if (error instanceof InputError || error instanceof RateLimitError) {
    return toolError(error.message);
  }
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "tool_failure",
      tool,
      error_class: error instanceof Error ? error.name : "UnknownError",
    })}\n`,
  );
  return toolError("The operation failed safely; no path or private content was returned.");
}

export function createMcpServer(
  config: AppConfig,
  store: SubmissionStore,
  identity: RequestIdentity,
): McpServer {
  const server = new McpServer({
    name: "grok-obsidian-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "submit_research_note",
    {
      title: "Submit research candidate",
      description:
        "Create one new untrusted research candidate in the fixed Grok staging inbox. The server chooses the path and filename. This tool cannot read, edit, move, promote, or delete vault content.",
      inputSchema: submitResearchNoteSchema,
      outputSchema: receiptSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const input: SubmissionInput = {
          title: args.title,
          body_markdown: args.body_markdown,
          idempotency_key: args.idempotency_key,
          ...(args.source_urls ? { source_urls: args.source_urls } : {}),
          ...(args.topic ? { topic: args.topic } : {}),
        };
        const receipt = await store.submit(identity.ownerSubject, input);
        return {
          structuredContent: { ...receipt },
          content: [{ type: "text", text: JSON.stringify(receipt) }],
        };
      } catch (error) {
        return publicToolFailure(error, "submit_research_note");
      }
    },
  );

  if (config.enableListSubmissions) {
    server.registerTool(
      "list_submissions",
      {
        title: "List own submission metadata",
        description:
          "List metadata-only receipts for research candidates submitted by the authenticated subject. This tool never reads note bodies or walks the inbox or vault.",
        inputSchema: listSubmissionsSchema,
        outputSchema: submissionPageSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const page = await store.list(identity.ownerSubject, args.limit, args.cursor);
          return {
            structuredContent: {
              submissions: page.submissions.map((submission) => ({ ...submission })),
              ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}),
            },
            content: [{ type: "text", text: JSON.stringify(page) }],
          };
        } catch (error) {
          return publicToolFailure(error, "list_submissions");
        }
      },
    );
  }

  return server;
}
