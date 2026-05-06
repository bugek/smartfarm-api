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

const createPlotSchema = z.object({
  farmSiteId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  areaRai: z.number().positive().max(100000).optional()
});

export const plotsRouter = Router();

plotsRouter.use(requireTenantContext);

plotsRouter.get("/", async (_req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const plots = await prisma.plot.findMany({
      where: {
        farmSite: {
          organizationId: tenant.organizationId
        }
      },
      orderBy: [
        {
          farmSite: {
            createdAt: "asc"
          }
        },
        {
          createdAt: "asc"
        }
      ],
      select: {
        id: true,
        name: true,
        areaRai: true,
        createdAt: true,
        updatedAt: true,
        farmSite: {
          select: {
            id: true,
            organizationId: true,
            name: true,
            code: true
          }
        }
      }
    });

    res.json({
      items: plots,
      organizationId: tenant.organizationId
    });
  } catch (error) {
    next(error);
  }
});

plotsRouter.post(
  "/",
  requireOrganizationRole([OrganizationRole.admin, OrganizationRole.compliance_lead]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createPlotSchema.parse(req.body);

      const farmSite = await prisma.farmSite.findFirst({
        where: {
          id: payload.farmSiteId,
          organizationId: tenant.organizationId
        },
        select: {
          id: true,
          name: true
        }
      });

      if (!farmSite) {
        return res.status(404).json({
          error: {
            code: "farm_site_not_found",
            message: "Farm site was not found in the active organization."
          }
        });
      }

      const plot = await prisma.plot.create({
        data: {
          farmSiteId: farmSite.id,
          name: payload.name,
          areaRai: payload.areaRai
        },
        select: {
          id: true,
          name: true,
          areaRai: true,
          createdAt: true,
          updatedAt: true,
          farmSite: {
            select: {
              id: true,
              organizationId: true,
              name: true,
              code: true
            }
          }
        }
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "plot",
        entityId: plot.id,
        action: "plot.created",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          farmSiteId: farmSite.id,
          farmSiteName: farmSite.name,
          name: plot.name,
          areaRai: plot.areaRai
        }
      });

      res.status(201).json({
        item: plot
      });
    } catch (error) {
      next(error);
    }
  }
);
