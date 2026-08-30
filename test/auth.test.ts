import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";

import { RequestAuthenticator } from "../src/auth.js";
import { createTestFixture } from "./helpers.js";

function requestWithHeaders(headers: IncomingMessage["headers"]): IncomingMessage {
  return { headers } as IncomingMessage;
}

test("local development refuses proxy-shaped requests", async () => {
  const fixture = await createTestFixture();
  try {
    const authenticator = new RequestAuthenticator(fixture.config);
    await assert.rejects(
      authenticator.authenticate(requestWithHeaders({ "cf-connecting-ip": "203.0.113.10" })),
      /refuses requests that appear to be proxied/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("Access authentication derives a pseudonym and never uses raw identity", async () => {
  const fixture = await createTestFixture();
  try {
    const accessConfig = {
      ...fixture.config,
      authMode: "cloudflare-access" as const,
      accessTeamDomain: "https://example.cloudflareaccess.com",
      accessAudience: "audience-tag",
    };
    const authenticator = new RequestAuthenticator(accessConfig, async () => ({
      iss: accessConfig.accessTeamDomain,
      sub: "raw-user-identifier",
      aud: accessConfig.accessAudience,
    }));
    const identity = await authenticator.authenticate(
      requestWithHeaders({ "cf-access-jwt-assertion": "synthetic-token" }),
    );
    assert.match(identity.ownerSubject, /^cf_[A-Za-z0-9_-]{32}$/u);
    assert.equal(identity.ownerSubject.includes("raw-user-identifier"), false);
  } finally {
    await fixture.cleanup();
  }
});
