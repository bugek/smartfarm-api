import { OrganizationRole, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

const operationLogSelect = {
  id: true,
  organizationId: true,
  farmSiteId: true,
  plotId: true,
  cropCycleId: true,
  workerId: true,
  activityType: true,
  occurredAt: true,
  notes: true,
  metadataJson: true,
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
  },
  cropCycle: {
    select: {
      id: true,
      cropName: true,
      startedAt: true,
      endedAt: true
    }
  },
  worker: {
    select: {
      id: true,
      fullName: true,
      roleTitle: true,
      isActive: true
    }
  }
} satisfies Prisma.OperationLogSelect;

type OperationLogPayload = Prisma.OperationLogGetPayload<{
  select: typeof operationLogSelect;
}>;

const operationLogWriteRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert,
  OrganizationRole.worker
];

const nullableIdSchema = z.union([z.string().trim().min(1), z.null()]);
const nullableStringSchema = z.union([z.string().trim().min(1), z.null()]);

const createOperationLogSchema = z.object({
  farmSiteId: z.string().trim().min(1),
  plotId: nullableIdSchema.optional(),
  cropCycleId: nullableIdSchema.optional(),
  workerId: nullableIdSchema.optional(),
  activityType: z.string().trim().min(1).max(80),
  occurredAt: z.string().datetime(),
  notes: z.union([z.string().trim().min(1).max(4000), z.null()]).optional(),
  metadata: z.record(z.any()).optional()
});

const updateOperationLogSchema = z
  .object({
    farmSiteId: z.string().trim().min(1).optional(),
    plotId: nullableIdSchema.optional(),
    cropCycleId: nullableIdSchema.optional(),
    workerId: nullableIdSchema.optional(),
    activityType: z.string().trim().min(1).max(80).optional(),
    occurredAt: z.string().datetime().optional(),
    notes: z.union([z.string().trim().min(1).max(4000), z.null()]).optional(),
    metadata: z.record(z.any()).optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided."
  });

const listOperationLogsQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional(),
  plotId: z.string().trim().min(1).optional(),
  cropCycleId: z.string().trim().min(1).optional(),
  workerId: z.string().trim().min(1).optional(),
  activityType: z.string().trim().min(1).optional()
});

export const operationLogsRouter = Router();

operationLogsRouter.use(requireTenantContext);

operationLogsRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listOperationLogsQuerySchema.parse(req.query);
    const items = await prisma.operationLog.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.farmSiteId ? { farmSiteId: filters.farmSiteId } : {}),
        ...(filters.plotId ? { plotId: filters.plotId } : {}),
        ...(filters.cropCycleId ? { cropCycleId: filters.cropCycleId } : {}),
        ...(filters.workerId ? { workerId: filters.workerId } : {}),
        ...(filters.activityType
          ? { activityType: { equals: filters.activityType, mode: "insensitive" } }
          : {})
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: operationLogSelect
    });

    res.json({
      items,
      organizationId: tenant.organizationId,
      filters: {
        farmSiteId: filters.farmSiteId ?? null,
        plotId: filters.plotId ?? null,
        cropCycleId: filters.cropCycleId ?? null,
        workerId: filters.workerId ?? null,
        activityType: filters.activityType ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

operationLogsRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const item = await findOperationLog(tenant.organizationId, String(req.params.id));

    if (!item) {
      return res.status(404).json({
        error: {
          code: "operation_log_not_found",
          message: "Operation log was not found in the active organization."
        }
      });
    }

    res.json({
      item
    });
  } catch (error) {
    next(error);
  }
});

operationLogsRouter.post(
  "/",
  requireOrganizationRole(operationLogWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createOperationLogSchema.parse(req.body);
      const resolution = await resolveOperationLogReferences(tenant.organizationId, {
        farmSiteId: payload.farmSiteId,
        plotId: payload.plotId ?? null,
        cropCycleId: payload.cropCycleId ?? null,
        workerId: payload.workerId ?? null
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({
          error: resolution.error
        });
      }

      const occurredAt = new Date(payload.occurredAt);
      const item = await prisma.$transaction(async (tx): Promise<OperationLogPayload> => {
        const created = await tx.operationLog.create({
          data: {
            organizationId: tenant.organizationId,
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot?.id ?? null,
            cropCycleId: resolution.cropCycle?.id ?? null,
            workerId: resolution.worker?.id ?? null,
            activityType: payload.activityType,
            occurredAt,
            notes: payload.notes ?? null,
            metadataJson: payload.metadata as Prisma.InputJsonValue | undefined
          },
          select: operationLogSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "operation_log",
            entityId: created.id,
            action: "operation_log.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: created.farmSite.id,
              farmSiteName: created.farmSite.name,
              plotId: created.plot?.id ?? null,
              cropCycleId: created.cropCycle?.id ?? null,
              workerId: created.worker?.id ?? null,
              activityType: created.activityType,
              occurredAt: created.occurredAt.toISOString()
            }
          }
        });

        return created;
      });

      res.status(201).json({
        item
      });
    } catch (error) {
      next(error);
    }
  }
);

operationLogsRouter.patch(
  "/:id",
  requireOrganizationRole(operationLogWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const operationLogId = String(req.params.id);
      const payload = updateOperationLogSchema.parse(req.body);
      const existing = await findOperationLog(tenant.organizationId, operationLogId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "operation_log_not_found",
            message: "Operation log was not found in the active organization."
          }
        });
      }

      const resolution = await resolveOperationLogReferences(tenant.organizationId, {
        farmSiteId: payload.farmSiteId ?? existing.farmSiteId,
        plotId: payload.plotId !== undefined ? payload.plotId : existing.plotId,
        cropCycleId: payload.cropCycleId !== undefined ? payload.cropCycleId : existing.cropCycleId,
        workerId: payload.workerId !== undefined ? payload.workerId : existing.workerId
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({
          error: resolution.error
        });
      }

      const item = await prisma.$transaction(async (tx): Promise<OperationLogPayload> => {
        const updated = await tx.operationLog.update({
          where: {
            id: existing.id
          },
          data: {
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot?.id ?? null,
            cropCycleId: resolution.cropCycle?.id ?? null,
            workerId: resolution.worker?.id ?? null,
            ...(payload.activityType !== undefined ? { activityType: payload.activityType } : {}),
            ...(payload.occurredAt !== undefined ? { occurredAt: new Date(payload.occurredAt) } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
            ...(payload.metadata !== undefined
              ? { metadataJson: payload.metadata as Prisma.InputJsonValue }
              : {})
          },
          select: operationLogSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "operation_log",
            entityId: existing.id,
            action: "operation_log.updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousFarmSiteId: existing.farmSite.id,
              nextFarmSiteId: updated.farmSite.id,
              previousPlotId: existing.plot?.id ?? null,
              nextPlotId: updated.plot?.id ?? null,
              previousCropCycleId: existing.cropCycle?.id ?? null,
              nextCropCycleId: updated.cropCycle?.id ?? null,
              previousWorkerId: existing.worker?.id ?? null,
              nextWorkerId: updated.worker?.id ?? null,
              previousActivityType: existing.activityType,
              nextActivityType: updated.activityType,
              previousOccurredAt: existing.occurredAt.toISOString(),
              nextOccurredAt: updated.occurredAt.toISOString()
            }
          }
        });

        return updated;
      });

      res.json({
        item
      });
    } catch (error) {
      next(error);
    }
  }
);

operationLogsRouter.delete(
  "/:id",
  requireOrganizationRole(operationLogWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const operationLogId = String(req.params.id);
      const existing = await findOperationLog(tenant.organizationId, operationLogId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "operation_log_not_found",
            message: "Operation log was not found in the active organization."
          }
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.operationLog.delete({
          where: {
            id: existing.id
          }
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "operation_log",
            entityId: existing.id,
            action: "operation_log.deleted",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: existing.farmSite.id,
              farmSiteName: existing.farmSite.name,
              plotId: existing.plot?.id ?? null,
              cropCycleId: existing.cropCycle?.id ?? null,
              workerId: existing.worker?.id ?? null,
              activityType: existing.activityType,
              occurredAt: existing.occurredAt.toISOString()
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

async function findOperationLog(organizationId: string, operationLogId: string) {
  return prisma.operationLog.findFirst({
    where: {
      id: operationLogId,
      organizationId
    },
    select: operationLogSelect
  });
}

async function resolveOperationLogReferences(
  organizationId: string,
  input: {
    farmSiteId: string;
    plotId: string | null;
    cropCycleId: string | null;
    workerId: string | null;
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

  const plot = input.plotId
    ? await prisma.plot.findFirst({
        where: {
          id: input.plotId,
          farmSite: {
            organizationId
          }
        },
        select: {
          id: true,
          name: true,
          farmSiteId: true
        }
      })
    : null;

  if (input.plotId && !plot) {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: "plot_not_found",
        message: "Plot was not found in the active organization."
      }
    };
  }

  if (plot && plot.farmSiteId !== farmSite.id) {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: "operation_log_context_conflict",
        message: "Plot does not belong to the selected farm site."
      }
    };
  }

  const cropCycle = input.cropCycleId
    ? await prisma.cropCycle.findFirst({
        where: {
          id: input.cropCycleId,
          organizationId
        },
        select: {
          id: true,
          cropName: true,
          farmSiteId: true,
          plotId: true
        }
      })
    : null;

  if (input.cropCycleId && !cropCycle) {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: "crop_cycle_not_found",
        message: "Crop cycle was not found in the active organization."
      }
    };
  }

  if (cropCycle && cropCycle.farmSiteId !== farmSite.id) {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: "operation_log_context_conflict",
        message: "Crop cycle does not belong to the selected farm site."
      }
    };
  }

  if (plot && cropCycle?.plotId && cropCycle.plotId !== plot.id) {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: "operation_log_context_conflict",
        message: "Crop cycle does not belong to the selected plot."
      }
    };
  }

  const worker = input.workerId
    ? await prisma.worker.findFirst({
        where: {
          id: input.workerId,
          organizationId
        },
        select: {
          id: true,
          fullName: true,
          farmSiteId: true
        }
      })
    : null;

  if (input.workerId && !worker) {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: "worker_not_found",
        message: "Worker was not found in the active organization."
      }
    };
  }

  if (worker?.farmSiteId && worker.farmSiteId !== farmSite.id) {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: "operation_log_context_conflict",
        message: "Worker is assigned to a different farm site."
      }
    };
  }

  return {
    ok: true as const,
    farmSite,
    plot,
    cropCycle,
    worker
  };
}
