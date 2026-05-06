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

const createCropCycleSchema = z.object({
  farmSiteId: z.string().trim().min(1),
  plotId: z.string().trim().min(1).optional(),
  cropName: z.string().trim().min(1).max(120),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional()
});

export const cropCyclesRouter = Router();

cropCyclesRouter.use(requireTenantContext);

cropCyclesRouter.get("/", async (_req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const cropCycles = await prisma.cropCycle.findMany({
      where: {
        organizationId: tenant.organizationId
      },
      orderBy: [
        {
          createdAt: "asc"
        }
      ],
      select: {
        id: true,
        organizationId: true,
        cropName: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        updatedAt: true,
        farmSite: {
          select: {
            id: true,
            name: true,
            code: true
          }
        },
        plot: {
          select: {
            id: true,
            name: true,
            areaRai: true
          }
        }
      }
    });

    res.json({
      items: cropCycles,
      organizationId: tenant.organizationId
    });
  } catch (error) {
    next(error);
  }
});

cropCyclesRouter.post(
  "/",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createCropCycleSchema.parse(req.body);

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

      let plot:
        | {
            id: string;
            name: string;
          }
        | null = null;

      if (payload.plotId) {
        plot = await prisma.plot.findFirst({
          where: {
            id: payload.plotId,
            farmSiteId: farmSite.id
          },
          select: {
            id: true,
            name: true
          }
        });

        if (!plot) {
          return res.status(404).json({
            error: {
              code: "plot_not_found",
              message: "Plot was not found in the selected farm site."
            }
          });
        }
      }

      const cropCycle = await prisma.cropCycle.create({
        data: {
          organizationId: tenant.organizationId,
          farmSiteId: farmSite.id,
          plotId: plot?.id,
          cropName: payload.cropName,
          startedAt: payload.startedAt ? new Date(payload.startedAt) : undefined,
          endedAt: payload.endedAt ? new Date(payload.endedAt) : undefined
        },
        select: {
          id: true,
          organizationId: true,
          cropName: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          updatedAt: true,
          farmSite: {
            select: {
              id: true,
              name: true,
              code: true
            }
          },
          plot: {
            select: {
              id: true,
              name: true,
              areaRai: true
            }
          }
        }
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "crop_cycle",
        entityId: cropCycle.id,
        action: "crop_cycle.created",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          farmSiteId: farmSite.id,
          farmSiteName: farmSite.name,
          plotId: plot?.id,
          plotName: plot?.name,
          cropName: cropCycle.cropName,
          startedAt: cropCycle.startedAt?.toISOString(),
          endedAt: cropCycle.endedAt?.toISOString()
        }
      });

      res.status(201).json({
        item: cropCycle
      });
    } catch (error) {
      next(error);
    }
  }
);
