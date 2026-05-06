import { OrganizationRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";

const createFarmSiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40).optional(),
  locationText: z.string().trim().min(1).max(500).optional()
});

export const farmSitesRouter = Router();

farmSitesRouter.use(requireTenantContext);

farmSitesRouter.get("/", async (_req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const farmSites = await prisma.farmSite.findMany({
      where: {
        organizationId: tenant.organizationId
      },
      orderBy: {
        createdAt: "asc"
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        code: true,
        locationText: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      items: farmSites,
      organizationId: tenant.organizationId
    });
  } catch (error) {
    next(error);
  }
});

farmSitesRouter.post(
  "/",
  requireOrganizationRole([OrganizationRole.admin, OrganizationRole.compliance_lead]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createFarmSiteSchema.parse(req.body);

      const farmSite = await prisma.farmSite.create({
        data: {
          organizationId: tenant.organizationId,
          name: payload.name,
          code: payload.code,
          locationText: payload.locationText
        },
        select: {
          id: true,
          organizationId: true,
          name: true,
          code: true,
          locationText: true,
          createdAt: true,
          updatedAt: true
        }
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "farm_site",
        entityId: farmSite.id,
        action: "farm_site.created",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          name: farmSite.name,
          code: farmSite.code
        }
      });

      res.status(201).json({
        item: farmSite
      });
    } catch (error) {
      next(error);
    }
  }
);
