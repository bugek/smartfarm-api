import type { NextFunction, Request, Response } from "express";
import { OrganizationRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const MEMBERSHIP_ROLES = new Set<string>(Object.values(OrganizationRole));

export type TenantContext = {
  organizationId: string;
  userId: string;
  membershipId: string;
  role: OrganizationRole;
};

type TenantLocals = {
  tenant?: TenantContext;
};

function sendAuthError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({
    error: {
      code,
      message
    }
  });
}

export async function requireTenantContext(
  req: Request,
  res: Response<unknown, TenantLocals>,
  next: NextFunction
) {
  const organizationId = req.header("x-organization-id")?.trim();
  const userId = req.header("x-user-id")?.trim();
  const requestedRole = req.header("x-membership-role")?.trim();

  if (!organizationId || !userId) {
    return sendAuthError(
      res,
      401,
      "tenant_headers_required",
      "x-organization-id and x-user-id headers are required."
    );
  }

  if (requestedRole && !MEMBERSHIP_ROLES.has(requestedRole)) {
    return sendAuthError(res, 400, "invalid_membership_role", "x-membership-role is invalid.");
  }

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId
      }
    },
    select: {
      id: true,
      role: true
    }
  });

  if (!membership) {
    return sendAuthError(
      res,
      403,
      "membership_not_found",
      "User is not a member of the requested organization."
    );
  }

  if (requestedRole && membership.role !== requestedRole) {
    return sendAuthError(
      res,
      403,
      "membership_role_mismatch",
      "Requested membership role does not match the persisted organization role."
    );
  }

  res.locals.tenant = {
    organizationId,
    userId,
    membershipId: membership.id,
    role: membership.role
  };

  return next();
}

export function getTenantContext(res: Response<unknown, TenantLocals>) {
  const tenant = res.locals.tenant;

  if (!tenant) {
    throw new Error("Tenant context missing. Ensure requireTenantContext middleware runs first.");
  }

  return tenant;
}

export function requireOrganizationRole(allowedRoles: OrganizationRole[]) {
  const allowed = new Set<OrganizationRole>(allowedRoles);

  return (_req: Request, res: Response<unknown, TenantLocals>, next: NextFunction) => {
    const tenant = getTenantContext(res);

    if (!allowed.has(tenant.role)) {
      return sendAuthError(
        res,
        403,
        "insufficient_role",
        `This action requires one of: ${allowedRoles.join(", ")}. Current role: ${tenant.role}.`
      );
    }

    return next();
  };
}
