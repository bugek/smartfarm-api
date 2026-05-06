import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { authConfig } from "./config.js";

export type AuthTokenKind = "access" | "refresh";

type TokenHeader = {
  alg: "HS256";
  typ: "JWT";
};

export type AuthTokenClaims = {
  sub: string;
  sid: string;
  jti: string;
  typ: AuthTokenKind;
  exp: number;
};

const TOKEN_HEADER: TokenHeader = {
  alg: "HS256",
  typ: "JWT"
};

function encodePart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signPayload(headerPart: string, payloadPart: string) {
  return createHmac("sha256", authConfig.tokenSecret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64url");
}

export function issueAuthToken(
  input: { userId: string; sessionId: string; kind: AuthTokenKind },
  ttlMs: number
) {
  const claims: AuthTokenClaims = {
    sub: input.userId,
    sid: input.sessionId,
    jti: randomUUID(),
    typ: input.kind,
    exp: Math.floor((Date.now() + ttlMs) / 1000)
  };

  const headerPart = encodePart(TOKEN_HEADER);
  const payloadPart = encodePart(claims);
  const signaturePart = signPayload(headerPart, payloadPart);

  return {
    token: `${headerPart}.${payloadPart}.${signaturePart}`,
    expiresAt: new Date(claims.exp * 1000).toISOString()
  };
}

export function verifyAuthToken(token: string, expectedKind?: AuthTokenKind): AuthTokenClaims | null {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = signPayload(headerPart, payloadPart);
  const actualBuffer = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as TokenHeader;
    const claims = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8")
    ) as AuthTokenClaims;

    if (header.alg !== TOKEN_HEADER.alg || header.typ !== TOKEN_HEADER.typ) {
      return null;
    }
    if (claims.exp * 1000 <= Date.now()) {
      return null;
    }
    if (expectedKind && claims.typ !== expectedKind) {
      return null;
    }
    if (!claims.sub || !claims.sid || !claims.jti || !claims.typ || !claims.exp) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}
