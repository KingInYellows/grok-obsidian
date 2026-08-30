import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { AuthenticationError } from "./errors.js";
import type { AppConfig, RequestIdentity } from "./types.js";

export type JwtValidator = (token: string) => Promise<JWTPayload>;

function pseudonymizeIdentity(issuer: string, subject: string): string {
  const digest = createHash("sha256")
    .update(`${issuer}\u0000${subject}`, "utf8")
    .digest("base64url")
    .slice(0, 32);
  return `cf_${digest}`;
}

export function createCloudflareJwtValidator(config: AppConfig): JwtValidator {
  const teamDomain = config.accessTeamDomain;
  const audience = config.accessAudience;
  if (!teamDomain || !audience) {
    throw new AuthenticationError("Cloudflare Access authentication is not configured");
  }
  const jwks = createRemoteJWKSet(
    new URL(`${teamDomain}/cdn-cgi/access/certs`),
  );
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience,
      algorithms: ["RS256"],
    });
    return payload;
  };
}

export class RequestAuthenticator {
  readonly #config: AppConfig;
  readonly #validateJwt?: JwtValidator;

  constructor(config: AppConfig, validateJwt?: JwtValidator) {
    this.#config = config;
    this.#validateJwt =
      validateJwt ??
      (config.authMode === "cloudflare-access"
        ? createCloudflareJwtValidator(config)
        : undefined);
  }

  async authenticate(request: IncomingMessage): Promise<RequestIdentity> {
    if (this.#config.authMode === "local-development") {
      if (
        request.headers["cf-access-jwt-assertion"] !== undefined ||
        request.headers["cf-connecting-ip"] !== undefined ||
        request.headers["cf-ray"] !== undefined ||
        request.headers["x-forwarded-for"] !== undefined
      ) {
        throw new AuthenticationError(
          "local-development mode refuses requests that appear to be proxied",
        );
      }
      return { ownerSubject: "local-development" };
    }

    const token = request.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || token.length === 0) {
      throw new AuthenticationError("missing Cloudflare Access assertion");
    }
    if (!this.#validateJwt) {
      throw new AuthenticationError("Cloudflare Access validator is unavailable");
    }

    let payload: JWTPayload;
    try {
      payload = await this.#validateJwt(token);
    } catch {
      throw new AuthenticationError("invalid Cloudflare Access assertion");
    }
    if (typeof payload.iss !== "string" || typeof payload.sub !== "string") {
      throw new AuthenticationError("Cloudflare Access assertion lacks a stable subject");
    }
    return { ownerSubject: pseudonymizeIdentity(payload.iss, payload.sub) };
  }
}
