import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { AuthenticationError, RateLimitError } from "./errors.js";
import { RequestAuthenticator } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import { SubjectRateLimiter } from "./rate-limit.js";
import { SubmissionStore } from "./storage.js";
import type { AppConfig } from "./types.js";

export interface RuntimeDependencies {
  readonly authenticator: RequestAuthenticator;
  readonly rateLimiter: SubjectRateLimiter;
  readonly store: SubmissionStore;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function writeJsonRpcError(response: ServerResponse, status: number, message: string): void {
  writeJson(response, status, {
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

function requestHostname(request: IncomingMessage): string | undefined {
  const host = request.headers.host;
  if (!host || host.includes(",")) return undefined;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function validateRequestBoundary(request: IncomingMessage, config: AppConfig): void {
  const remoteAddress = request.socket.remoteAddress;
  if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::ffff:127.0.0.1") {
    throw new AuthenticationError("non-loopback peer rejected");
  }
  const hostname = requestHostname(request);
  if (!hostname || !config.allowedHosts.has(hostname)) {
    throw new AuthenticationError("host header rejected");
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    if (typeof origin !== "string" || !config.allowedOrigins.has(origin)) {
      throw new AuthenticationError("origin rejected");
    }
  }
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new InputBodyError(415, "Content-Type must be application/json");
  }
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new InputBodyError(400, "Invalid Content-Length");
    }
    if (parsedLength > maximumBytes) {
      throw new InputBodyError(413, "Request body exceeds the configured limit");
    }
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maximumBytes) {
      throw new InputBodyError(413, "Request body exceeds the configured limit");
    }
    chunks.push(buffer);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(decoded);
  } catch {
    throw new InputBodyError(400, "Request body is not valid UTF-8 JSON");
  }
}

class InputBodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createHttpServer(
  config: AppConfig,
  dependencies: RuntimeDependencies,
): Server {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");

    try {
      validateRequestBoundary(request, config);
      if (request.url !== "/mcp") {
        writeJsonRpcError(response, 404, "Not found");
        return;
      }

      const identity = await dependencies.authenticator.authenticate(request);
      dependencies.rateLimiter.consume(identity.ownerSubject);

      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        writeJsonRpcError(response, 405, "Method not allowed");
        return;
      }

      const parsedBody = await readJsonBody(request, config.maxRequestBytes);
      const mcpServer = createMcpServer(config, dependencies.store, identity);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        void transport.close();
        void mcpServer.close();
      };
      response.once("finish", cleanup);
      response.once("close", cleanup);
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        writeJsonRpcError(response, 401, "Unauthorized");
      } else if (error instanceof RateLimitError) {
        response.setHeader("Retry-After", "60");
        writeJsonRpcError(response, 429, "Rate limit exceeded");
      } else if (error instanceof InputBodyError) {
        writeJsonRpcError(response, error.status, error.message);
      } else {
        process.stderr.write(
          `${JSON.stringify({
            level: "error",
            event: "http_request_failure",
            error_class: error instanceof Error ? error.name : "UnknownError",
          })}\n`,
        );
        writeJsonRpcError(response, 500, "Internal server error");
      }
    }
  });
}
