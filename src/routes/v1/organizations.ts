import { OrganizationRole } from "@prisma/client";
import { Router } from "express";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireTenantContext);

organizationsRouter.get("/", async (_req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const organizations = await prisma.organization.findMany({
      where: {
        memberships: {
          some: {
            userId: tenant.userId
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          where: {
            userId: tenant.userId
          },
          select: {
            id: true,
            role: true
          }
        },
        _count: {
          select: {
            farmSites: true,
            memberships: true
          }
        }
      }
    });

    res.json({
      items: organizations,
      activeOrganizationId: tenant.organizationId
    });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.get(
  "/current/memberships",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (_req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const memberships = await prisma.membership.findMany({
        where: {
          organizationId: tenant.organizationId
        },
        orderBy: [
          {
            role: "asc"
          },
          {
            createdAt: "asc"
          }
        ],
        select: {
          id: true,
          organizationId: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      });

      res.json({
        items: memberships,
        organizationId: tenant.organizationId
      });
    } catch (error) {
      next(error);
    }
  }
);
