import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  createAuthTokens,
  getSessionPayloadForUser,
  hashRefreshToken,
  verifyUserCredentials
} from "../../auth/session.js";
import { issueAuthToken, verifyAuthToken } from "../../auth/tokens.js";
import { authConfig } from "../../auth/config.js";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1)
});

export const authRouter = Router();

function readBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader) return undefined;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

async function buildAuthResponse(userId: string) {
  const session = await getSessionPayloadForUser(userId);
  if (!session) {
    return null;
  }

  return {
    ...(await createAuthTokens(userId)),
    session
  };
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const user = await verifyUserCredentials(payload.email, payload.password);

    if (!user) {
      return res.status(401).json({
        error: {
          code: "invalid_credentials",
          message: "Email or password is incorrect."
        }
      });
    }

    const response = await buildAuthResponse(user.id);
    if (!response) {
      return res.status(404).json({
        error: {
          code: "user_not_found",
          message: "User could not be loaded after login."
        }
      });
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const payload = refreshSchema.parse(req.body);
    const claims = verifyAuthToken(payload.refreshToken, "refresh");
    if (!claims) {
      return res.status(401).json({
        error: {
          code: "invalid_refresh_token",
          message: "Refresh token is invalid or expired."
        }
      });
    }

    const authSession = await prisma.authSession.findUnique({
      where: {
        id: claims.sid
      },
      select: {
        id: true,
        userId: true,
        refreshTokenHash: true,
        refreshTokenExpiresAt: true,
        revokedAt: true
      }
    });

    if (
      !authSession ||
      authSession.userId !== claims.sub ||
      authSession.revokedAt ||
      authSession.refreshTokenExpiresAt.getTime() <= Date.now() ||
      authSession.refreshTokenHash !== hashRefreshToken(payload.refreshToken)
    ) {
      return res.status(401).json({
        error: {
          code: "invalid_refresh_token",
          message: "Refresh token is invalid or expired."
        }
      });
    }

    const nextRefreshToken = issueAuthToken(
      { userId: authSession.userId, sessionId: authSession.id, kind: "refresh" },
      authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000
    );
    const nextAccessToken = issueAuthToken(
      { userId: authSession.userId, sessionId: authSession.id, kind: "access" },
      authConfig.accessTokenTtlMinutes * 60 * 1000
    );

    await prisma.authSession.update({
      where: {
        id: authSession.id
      },
      data: {
        refreshTokenHash: hashRefreshToken(nextRefreshToken.token),
        refreshTokenExpiresAt: new Date(nextRefreshToken.expiresAt),
        lastUsedAt: new Date()
      }
    });

    const session = await getSessionPayloadForUser(authSession.userId);
    if (!session) {
      return res.status(404).json({
        error: {
          code: "user_not_found",
          message: "User session no longer exists."
        }
      });
    }

    res.json({
      accessToken: nextAccessToken.token,
      refreshToken: nextRefreshToken.token,
      accessTokenExpiresAt: nextAccessToken.expiresAt,
      refreshTokenExpiresAt: nextRefreshToken.expiresAt,
      session
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/session", async (req, res, next) => {
  try {
    const token = readBearerToken(req.header("authorization"));
    const claims = token ? verifyAuthToken(token, "access") : null;
    if (!claims) {
      return res.status(401).json({
        error: {
          code: "invalid_access_token",
          message: "Bearer access token is required."
        }
      });
    }

    const authSession = await prisma.authSession.findUnique({
      where: {
        id: claims.sid
      },
      select: {
        userId: true,
        revokedAt: true
      }
    });

    if (!authSession || authSession.userId !== claims.sub || authSession.revokedAt) {
      return res.status(401).json({
        error: {
          code: "invalid_access_token",
          message: "Bearer access token is invalid."
        }
      });
    }

    const session = await getSessionPayloadForUser(claims.sub);
    if (!session) {
      return res.status(404).json({
        error: {
          code: "user_not_found",
          message: "User session no longer exists."
        }
      });
    }

    res.json(session);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const payload = logoutSchema.parse(req.body);
    const claims = verifyAuthToken(payload.refreshToken, "refresh");

    if (claims) {
      await prisma.authSession.updateMany({
        where: {
          id: claims.sid,
          userId: claims.sub,
          refreshTokenHash: hashRefreshToken(payload.refreshToken),
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      });
    }

    res.json({
      ok: true
    });
  } catch (error) {
    next(error);
  }
});
