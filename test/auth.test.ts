import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";

import { generateKeyPair, exportJWK, SignJWT } from "jose";

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


test("Access verifies signed claims and rejects missing expiry, wrong audience and forged assertions", async (t) => {
  const fixture = await createTestFixture();
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "synthetic-fixture", alg: "RS256" };
  const accessConfig = { ...fixture.config, authMode: "cloudflare-access" as const,
    accessTeamDomain: "https://fixture.cloudflareaccess.com", accessAudience: "fixture-audience" };
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    assert.equal(String(url), `${accessConfig.accessTeamDomain}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  });
  try {
    const authenticator = new RequestAuthenticator(accessConfig);
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: accessConfig.accessTeamDomain, aud: accessConfig.accessAudience,
      sub: "synthetic-subject", exp: now + 60 };
    const sign = (payload: Record<string, unknown>) => new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "synthetic-fixture" }).sign(privateKey);
    const request = (token: string) => requestWithHeaders({ "cf-access-jwt-assertion": token });
    assert.match((await authenticator.authenticate(request(await sign(claims)))).ownerSubject, /^cf_/);
    for (const payload of [
      { iss: claims.iss, aud: claims.aud, sub: claims.sub },
      { ...claims, exp: now - 1 }, { ...claims, aud: "wrong-audience" },
      { ...claims, iss: "https://wrong.cloudflareaccess.com" }, { ...claims, sub: "" },
    ]) await assert.rejects(authenticator.authenticate(request(await sign(payload))));
    await assert.rejects(authenticator.authenticate(request("forged.assertion.value")));
    await assert.rejects(authenticator.authenticate(requestWithHeaders({
      "cf-access-authenticated-user-email": "synthetic@example.com", "cf-connecting-ip": "192.0.2.1",
    })));
    const valid = await sign(claims);
    await assert.rejects(authenticator.authenticate(request(`${valid}, ${valid}`)));
  } finally { await fixture.cleanup(); }
});
