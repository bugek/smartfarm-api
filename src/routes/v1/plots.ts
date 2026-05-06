import { OrganizationRole, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

const plotSelect = {
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
} satisfies Prisma.PlotSelect;

type PlotPayload = Prisma.PlotGetPayload<{
  select: typeof plotSelect;
}>;

const plotWriteRoles = [OrganizationRole.admin, OrganizationRole.compliance_lead];

const createPlotSchema = z.object({
  farmSiteId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  areaRai: z.number().positive().max(100000).optional()
});

const updatePlotSchema = z
  .object({
    farmSiteId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    areaRai: z.union([z.number().positive().max(100000), z.null()]).optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided."
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
      select: plotSelect
    });

    res.json({
      items: plots,
      organizationId: tenant.organizationId
    });
  } catch (error) {
    next(error);
  }
});

plotsRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const plot = await findPlot(tenant.organizationId, String(req.params.id));

    if (!plot) {
      return res.status(404).json({
        error: {
          code: "plot_not_found",
          message: "Plot was not found in the active organization."
        }
      });
    }

    res.json({
      item: plot
    });
  } catch (error) {
    next(error);
  }
});

plotsRouter.post(
  "/",
  requireOrganizationRole(plotWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createPlotSchema.parse(req.body);
      const farmSite = await findFarmSite(tenant.organizationId, payload.farmSiteId);

      if (!farmSite) {
        return res.status(404).json({
          error: {
            code: "farm_site_not_found",
            message: "Farm site was not found in the active organization."
          }
        });
      }

      const plot = await prisma.$transaction(async (tx): Promise<PlotPayload> => {
        const created = await tx.plot.create({
          data: {
            farmSiteId: farmSite.id,
            name: payload.name,
            areaRai: payload.areaRai
          },
          select: plotSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "plot",
            entityId: created.id,
            action: "plot.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: farmSite.id,
              farmSiteName: farmSite.name,
              name: created.name,
              areaRai: created.areaRai
            }
          }
        });

        return created;
      });

      res.status(201).json({
        item: plot
      });
    } catch (error) {
      next(error);
    }
  }
);

plotsRouter.patch(
  "/:id",
  requireOrganizationRole(plotWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const plotId = String(req.params.id);
      const payload = updatePlotSchema.parse(req.body);
      const existing = await findPlot(tenant.organizationId, plotId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "plot_not_found",
            message: "Plot was not found in the active organization."
          }
        });
      }

      const targetFarmSiteId = payload.farmSiteId ?? existing.farmSite.id;
      const farmSite = await findFarmSite(tenant.organizationId, targetFarmSiteId);

      if (!farmSite) {
        return res.status(404).json({
          error: {
            code: "farm_site_not_found",
            message: "Farm site was not found in the active organization."
          }
        });
      }

      const updated = await prisma.$transaction(async (tx): Promise<PlotPayload> => {
        const item = await tx.plot.update({
          where: {
            id: existing.id
          },
          data: {
            farmSiteId: farmSite.id,
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.areaRai !== undefined ? { areaRai: payload.areaRai } : {})
          },
          select: plotSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "plot",
            entityId: existing.id,
            action: "plot.updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousFarmSiteId: existing.farmSite.id,
              nextFarmSiteId: item.farmSite.id,
              previousName: existing.name,
              nextName: item.name,
              previousAreaRai: existing.areaRai,
              nextAreaRai: item.areaRai
            }
          }
        });

        return item;
      });

      res.json({
        item: updated
      });
    } catch (error) {
      next(error);
    }
  }
);

plotsRouter.delete(
  "/:id",
  requireOrganizationRole(plotWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const plotId = String(req.params.id);
      const existing = await prisma.plot.findFirst({
        where: {
          id: plotId,
          farmSite: {
            organizationId: tenant.organizationId
          }
        },
        select: {
          id: true,
          name: true,
          areaRai: true,
          farmSite: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              cropCycles: true,
              operationLogs: true
            }
          }
        }
      });

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "plot_not_found",
            message: "Plot was not found in the active organization."
          }
        });
      }

      if (existing._count.cropCycles > 0 || existing._count.operationLogs > 0) {
        return res.status(409).json({
          error: {
            code: "plot_in_use",
            message:
              "Plot cannot be deleted while crop cycles or operation logs still reference it."
          }
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.plot.delete({
          where: {
            id: existing.id
          }
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "plot",
            entityId: existing.id,
            action: "plot.deleted",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: existing.farmSite.id,
              farmSiteName: existing.farmSite.name,
              name: existing.name,
              areaRai: existing.areaRai
            }
          }
        });
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

async function findFarmSite(organizationId: string, farmSiteId: string) {
  return prisma.farmSite.findFirst({
    where: {
      id: farmSiteId,
      organizationId
    },
    select: {
      id: true,
      name: true,
      code: true,
      organizationId: true
    }
  });
}

async function findPlot(organizationId: string, plotId: string) {
  return prisma.plot.findFirst({
    where: {
      id: plotId,
      farmSite: {
        organizationId
      }
    },
    select: plotSelect
  });
}
