import { OrganizationRole, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

const cropCycleSelect = {
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
} satisfies Prisma.CropCycleSelect;

type CropCyclePayload = Prisma.CropCycleGetPayload<{
  select: typeof cropCycleSelect;
}>;

const cropCycleWriteRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert
];

const nullableDatetimeSchema = z.union([z.string().datetime(), z.null()]);

const createCropCycleSchema = z.object({
  farmSiteId: z.string().trim().min(1),
  plotId: z.union([z.string().trim().min(1), z.null()]).optional(),
  cropName: z.string().trim().min(1).max(120),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional()
});

const updateCropCycleSchema = z
  .object({
    farmSiteId: z.string().trim().min(1).optional(),
    plotId: z.union([z.string().trim().min(1), z.null()]).optional(),
    cropName: z.string().trim().min(1).max(120).optional(),
    startedAt: nullableDatetimeSchema.optional(),
    endedAt: nullableDatetimeSchema.optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided."
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
      select: cropCycleSelect
    });

    res.json({
      items: cropCycles,
      organizationId: tenant.organizationId
    });
  } catch (error) {
    next(error);
  }
});

cropCyclesRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const cropCycle = await findCropCycle(tenant.organizationId, String(req.params.id));

    if (!cropCycle) {
      return res.status(404).json({
        error: {
          code: "crop_cycle_not_found",
          message: "Crop cycle was not found in the active organization."
        }
      });
    }

    res.json({
      item: cropCycle
    });
  } catch (error) {
    next(error);
  }
});

cropCyclesRouter.post(
  "/",
  requireOrganizationRole(cropCycleWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createCropCycleSchema.parse(req.body);
      const resolution = await resolveCropCycleInputs(tenant.organizationId, {
        farmSiteId: payload.farmSiteId,
        plotId: payload.plotId ?? null
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({
          error: resolution.error
        });
      }

      const startedAt = payload.startedAt ? new Date(payload.startedAt) : null;
      const endedAt = payload.endedAt ? new Date(payload.endedAt) : null;

      if (startedAt && endedAt && endedAt < startedAt) {
        return res.status(400).json({
          error: {
            code: "invalid_crop_cycle_dates",
            message: "endedAt must be on or after startedAt."
          }
        });
      }

      const cropCycle = await prisma.$transaction(async (tx): Promise<CropCyclePayload> => {
        const created = await tx.cropCycle.create({
          data: {
            organizationId: tenant.organizationId,
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot?.id,
            cropName: payload.cropName,
            startedAt: startedAt ?? undefined,
            endedAt: endedAt ?? undefined
          },
          select: cropCycleSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "crop_cycle",
            entityId: created.id,
            action: "crop_cycle.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: resolution.farmSite.id,
              farmSiteName: resolution.farmSite.name,
              plotId: resolution.plot?.id ?? null,
              plotName: resolution.plot?.name ?? null,
              cropName: created.cropName,
              startedAt: created.startedAt?.toISOString() ?? null,
              endedAt: created.endedAt?.toISOString() ?? null
            }
          }
        });

        return created;
      });

      res.status(201).json({
        item: cropCycle
      });
    } catch (error) {
      next(error);
    }
  }
);

cropCyclesRouter.patch(
  "/:id",
  requireOrganizationRole(cropCycleWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const cropCycleId = String(req.params.id);
      const payload = updateCropCycleSchema.parse(req.body);
      const existing = await findCropCycle(tenant.organizationId, cropCycleId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "crop_cycle_not_found",
            message: "Crop cycle was not found in the active organization."
          }
        });
      }

      const resolution = await resolveCropCycleInputs(tenant.organizationId, {
        farmSiteId: payload.farmSiteId ?? existing.farmSite.id,
        plotId: payload.plotId !== undefined ? payload.plotId : (existing.plot?.id ?? null)
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({
          error: resolution.error
        });
      }

      const startedAt =
        payload.startedAt !== undefined
          ? (payload.startedAt ? new Date(payload.startedAt) : null)
          : existing.startedAt;
      const endedAt =
        payload.endedAt !== undefined ? (payload.endedAt ? new Date(payload.endedAt) : null) : existing.endedAt;

      if (startedAt && endedAt && endedAt < startedAt) {
        return res.status(400).json({
          error: {
            code: "invalid_crop_cycle_dates",
            message: "endedAt must be on or after startedAt."
          }
        });
      }

      const updated = await prisma.$transaction(async (tx): Promise<CropCyclePayload> => {
        const item = await tx.cropCycle.update({
          where: {
            id: existing.id
          },
          data: {
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot?.id ?? null,
            ...(payload.cropName !== undefined ? { cropName: payload.cropName } : {}),
            ...(payload.startedAt !== undefined ? { startedAt } : {}),
            ...(payload.endedAt !== undefined ? { endedAt } : {})
          },
          select: cropCycleSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "crop_cycle",
            entityId: existing.id,
            action: "crop_cycle.updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousFarmSiteId: existing.farmSite.id,
              nextFarmSiteId: item.farmSite.id,
              previousPlotId: existing.plot?.id ?? null,
              nextPlotId: item.plot?.id ?? null,
              previousCropName: existing.cropName,
              nextCropName: item.cropName,
              previousStartedAt: existing.startedAt?.toISOString() ?? null,
              nextStartedAt: item.startedAt?.toISOString() ?? null,
              previousEndedAt: existing.endedAt?.toISOString() ?? null,
              nextEndedAt: item.endedAt?.toISOString() ?? null
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

cropCyclesRouter.delete(
  "/:id",
  requireOrganizationRole(cropCycleWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const cropCycleId = String(req.params.id);
      const existing = await prisma.cropCycle.findFirst({
        where: {
          id: cropCycleId,
          organizationId: tenant.organizationId
        },
        select: {
          id: true,
          cropName: true,
          startedAt: true,
          endedAt: true,
          farmSite: {
            select: {
              id: true,
              name: true
            }
          },
          plot: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              gapRecords: true,
              operationLogs: true
            }
          }
        }
      });

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "crop_cycle_not_found",
            message: "Crop cycle was not found in the active organization."
          }
        });
      }

      if (existing._count.gapRecords > 0 || existing._count.operationLogs > 0) {
        return res.status(409).json({
          error: {
            code: "crop_cycle_in_use",
            message:
              "Crop cycle cannot be deleted while GAP records or operation logs still reference it."
          }
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.cropCycle.delete({
          where: {
            id: existing.id
          }
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "crop_cycle",
            entityId: existing.id,
            action: "crop_cycle.deleted",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: existing.farmSite.id,
              farmSiteName: existing.farmSite.name,
              plotId: existing.plot?.id ?? null,
              plotName: existing.plot?.name ?? null,
              cropName: existing.cropName,
              startedAt: existing.startedAt?.toISOString() ?? null,
              endedAt: existing.endedAt?.toISOString() ?? null
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

async function findCropCycle(organizationId: string, cropCycleId: string) {
  return prisma.cropCycle.findFirst({
    where: {
      id: cropCycleId,
      organizationId
    },
    select: cropCycleSelect
  });
}

async function resolveCropCycleInputs(
  organizationId: string,
  input: {
    farmSiteId: string;
    plotId: string | null;
  }
) {
  const farmSite = await prisma.farmSite.findFirst({
    where: {
      id: input.farmSiteId,
      organizationId
    },
    select: {
      id: true,
      name: true
    }
  });

  if (!farmSite) {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: "farm_site_not_found",
        message: "Farm site was not found in the active organization."
      }
    };
  }

  if (!input.plotId) {
    return {
      ok: true as const,
      farmSite,
      plot: null
    };
  }

  const plot = await prisma.plot.findFirst({
    where: {
      id: input.plotId,
      farmSiteId: farmSite.id
    },
    select: {
      id: true,
      name: true
    }
  });

  if (!plot) {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: "plot_not_found",
        message: "Plot was not found in the selected farm site."
      }
    };
  }

  return {
    ok: true as const,
    farmSite,
    plot
  };
}
