import { loadConfig } from "./config.js";
import { RequestAuthenticator } from "./auth.js";
import { createHttpServer } from "./http.js";
import { SubjectRateLimiter } from "./rate-limit.js";
import { SubmissionStore } from "./storage.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const store = new SubmissionStore(config);
  await store.initialize();
  const server = createHttpServer(config, {
    authenticator: new RequestAuthenticator(config),
    rateLimiter: new SubjectRateLimiter(config.requestsPerMinute),
    store,
  });

  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        event: "server_listening",
        address: config.host,
        port: config.port,
        auth_mode: config.authMode,
        tools: [
          "submit_research_note",
          ...(config.enableListSubmissions ? ["list_submissions"] : []),
        ],
      })}\n`,
    );
  });

  const shutdown = () => {
    server.close((error) => {
      if (error) {
        process.stderr.write(
          `${JSON.stringify({ level: "error", event: "shutdown_failure" })}\n`,
        );
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "startup_failure",
      error_class: error instanceof Error ? error.name : "UnknownError",
    })}\n`,
  );
  process.exitCode = 1;
});
