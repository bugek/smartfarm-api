import { OrganizationRole, Prisma } from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { authConfig } from "./config.js";
import { hashPassword, verifyPassword } from "./password.js";
import { issueAuthToken } from "./tokens.js";
import { prisma } from "../lib/prisma.js";

const authUserSelect = {
  id: true,
  email: true,
  displayName: true,
  passwordHash: true,
  memberships: {
    orderBy: [
      {
        createdAt: "asc"
      }
    ],
    select: {
      id: true,
      organizationId: true,
      role: true,
      organization: {
        select: {
          name: true
        }
      }
    }
  }
} satisfies Prisma.UserSelect;

type AuthUserRecord = Prisma.UserGetPayload<{
  select: typeof authUserSelect;
}>;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashRefreshToken(refreshToken: string) {
  return createHash("sha256").update(refreshToken).digest("hex");
}

export async function ensureBootstrapUser(email: string, password: string) {
  if (!authConfig.bootstrap.enabled) {
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  if (
    normalizedEmail !== normalizeEmail(authConfig.bootstrap.email) ||
    password !== authConfig.bootstrap.password
  ) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({
      where: {
        email: normalizedEmail
      },
      select: {
        id: true,
        passwordHash: true
      }
    });

    if (!user) {
      user = await tx.user.create({
        data: {
          email: normalizedEmail,
          displayName: authConfig.bootstrap.displayName,
          passwordHash: await hashPassword(authConfig.bootstrap.password)
        },
        select: {
          id: true,
          passwordHash: true
        }
      });
    } else if (!user.passwordHash) {
      user = await tx.user.update({
        where: {
          id: user.id
        },
        data: {
          passwordHash: await hashPassword(authConfig.bootstrap.password)
        },
        select: {
          id: true,
          passwordHash: true
        }
      });
    }

    const existingMembership = await tx.membership.findFirst({
      where: {
        userId: user.id
      },
      select: {
        id: true
      }
    });

    if (existingMembership) {
      return;
    }

    const organization = await tx.organization.create({
      data: {
        name: authConfig.bootstrap.organizationName,
        description: "Development bootstrap organization for SmartFarm local auth."
      },
      select: {
        id: true
      }
    });

    await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: OrganizationRole.admin
      }
    });
  });
}

export async function getAuthUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: {
      email: normalizeEmail(email)
    },
    select: authUserSelect
  });
}

export async function verifyUserCredentials(email: string, password: string) {
  await ensureBootstrapUser(email, password);
  const user = await getAuthUserByEmail(email);
  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  return valid ? user : null;
}

export function buildSessionPayload(user: AuthUserRecord) {
  const memberships = user.memberships.map((membership) => ({
    id: membership.id,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role
  }));

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName
    },
    activeOrganizationId: memberships[0]?.organizationId ?? null,
    memberships
  };
}

export async function getSessionPayloadForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId
    },
    select: authUserSelect
  });

  return user ? buildSessionPayload(user) : null;
}

export async function createAuthTokens(userId: string) {
  const sessionId = randomUUID();
  const accessToken = issueAuthToken(
    { userId, sessionId, kind: "access" },
    authConfig.accessTokenTtlMinutes * 60 * 1000
  );
  const refreshToken = issueAuthToken(
    { userId, sessionId, kind: "refresh" },
    authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000
  );

  await prisma.authSession.create({
    data: {
      id: sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken.token),
      refreshTokenExpiresAt: new Date(refreshToken.expiresAt)
    }
  });

  return {
    accessToken: accessToken.token,
    refreshToken: refreshToken.token,
    accessTokenExpiresAt: accessToken.expiresAt,
    refreshTokenExpiresAt: refreshToken.expiresAt
  };
}
