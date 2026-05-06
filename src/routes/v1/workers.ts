import { OrganizationRole, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

const workerSelect = {
  id: true,
  organizationId: true,
  farmSiteId: true,
  fullName: true,
  phone: true,
  roleTitle: true,
  notes: true,
  isActive: true,
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
} satisfies Prisma.WorkerSelect;

type WorkerPayload = Prisma.WorkerGetPayload<{
  select: typeof workerSelect;
}>;

const workerWriteRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert
];

const createWorkerSchema = z.object({
  farmSiteId: z.union([z.string().trim().min(1), z.null()]).optional(),
  fullName: z.string().trim().min(1).max(120),
  phone: z.union([z.string().trim().min(1).max(40), z.null()]).optional(),
  roleTitle: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
  notes: z.union([z.string().trim().min(1).max(2000), z.null()]).optional(),
  isActive: z.boolean().optional()
});

const updateWorkerSchema = z
  .object({
    farmSiteId: z.union([z.string().trim().min(1), z.null()]).optional(),
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: z.union([z.string().trim().min(1).max(40), z.null()]).optional(),
    roleTitle: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
    notes: z.union([z.string().trim().min(1).max(2000), z.null()]).optional(),
    isActive: z.boolean().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided."
  });

const listWorkersQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional(),
  isActive: z.enum(["true", "false"]).optional()
});

export const workersRouter = Router();

workersRouter.use(requireTenantContext);

workersRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listWorkersQuerySchema.parse(req.query);
    const workers = await prisma.worker.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.farmSiteId ? { farmSiteId: filters.farmSiteId } : {}),
        ...(filters.isActive ? { isActive: filters.isActive === "true" } : {})
      },
      orderBy: [{ fullName: "asc" }, { createdAt: "asc" }],
      select: workerSelect
    });

    res.json({
      items: workers,
      organizationId: tenant.organizationId,
      filters: {
        farmSiteId: filters.farmSiteId ?? null,
        isActive: filters.isActive ? filters.isActive === "true" : null
      }
    });
  } catch (error) {
    next(error);
  }
});

workersRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const worker = await findWorker(tenant.organizationId, String(req.params.id));

    if (!worker) {
      return res.status(404).json({
        error: {
          code: "worker_not_found",
          message: "Worker was not found in the active organization."
        }
      });
    }

    res.json({
      item: worker
    });
  } catch (error) {
    next(error);
  }
});

workersRouter.post(
  "/",
  requireOrganizationRole(workerWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createWorkerSchema.parse(req.body);
      const farmSite = payload.farmSiteId
        ? await findFarmSite(tenant.organizationId, payload.farmSiteId)
        : null;

      if (payload.farmSiteId && !farmSite) {
        return res.status(404).json({
          error: {
            code: "farm_site_not_found",
            message: "Farm site was not found in the active organization."
          }
        });
      }

      const worker = await prisma.$transaction(async (tx): Promise<WorkerPayload> => {
        const created = await tx.worker.create({
          data: {
            organizationId: tenant.organizationId,
            farmSiteId: farmSite?.id ?? null,
            fullName: payload.fullName,
            phone: payload.phone ?? null,
            roleTitle: payload.roleTitle ?? null,
            notes: payload.notes ?? null,
            isActive: payload.isActive ?? true
          },
          select: workerSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "worker",
            entityId: created.id,
            action: "worker.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: created.farmSite?.id ?? null,
              farmSiteName: created.farmSite?.name ?? null,
              fullName: created.fullName,
              roleTitle: created.roleTitle,
              isActive: created.isActive
            }
          }
        });

        return created;
      });

      res.status(201).json({
        item: worker
      });
    } catch (error) {
      next(error);
    }
  }
);

workersRouter.patch(
  "/:id",
  requireOrganizationRole(workerWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const workerId = String(req.params.id);
      const payload = updateWorkerSchema.parse(req.body);
      const existing = await findWorker(tenant.organizationId, workerId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "worker_not_found",
            message: "Worker was not found in the active organization."
          }
        });
      }

      const targetFarmSiteId =
        payload.farmSiteId !== undefined ? payload.farmSiteId : existing.farmSite?.id ?? null;
      const farmSite = targetFarmSiteId
        ? await findFarmSite(tenant.organizationId, targetFarmSiteId)
        : null;

      if (targetFarmSiteId && !farmSite) {
        return res.status(404).json({
          error: {
            code: "farm_site_not_found",
            message: "Farm site was not found in the active organization."
          }
        });
      }

      const updated = await prisma.$transaction(async (tx): Promise<WorkerPayload> => {
        const item = await tx.worker.update({
          where: {
            id: existing.id
          },
          data: {
            farmSiteId: farmSite?.id ?? null,
            ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
            ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
            ...(payload.roleTitle !== undefined ? { roleTitle: payload.roleTitle } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
            ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {})
          },
          select: workerSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "worker",
            entityId: existing.id,
            action: "worker.updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousFarmSiteId: existing.farmSite?.id ?? null,
              nextFarmSiteId: item.farmSite?.id ?? null,
              previousFullName: existing.fullName,
              nextFullName: item.fullName,
              previousPhone: existing.phone,
              nextPhone: item.phone,
              previousRoleTitle: existing.roleTitle,
              nextRoleTitle: item.roleTitle,
              previousIsActive: existing.isActive,
              nextIsActive: item.isActive
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

workersRouter.delete(
  "/:id",
  requireOrganizationRole(workerWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const workerId = String(req.params.id);
      const existing = await prisma.worker.findFirst({
        where: {
          id: workerId,
          organizationId: tenant.organizationId
        },
        select: {
          id: true,
          fullName: true,
          roleTitle: true,
          isActive: true,
          farmSite: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              operationLogs: true
            }
          }
        }
      });

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "worker_not_found",
            message: "Worker was not found in the active organization."
          }
        });
      }

      if (existing._count.operationLogs > 0) {
        return res.status(409).json({
          error: {
            code: "worker_in_use",
            message: "Worker cannot be deleted while operation logs still reference it."
          }
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.worker.delete({
          where: {
            id: existing.id
          }
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "worker",
            entityId: existing.id,
            action: "worker.deleted",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: existing.farmSite?.id ?? null,
              farmSiteName: existing.farmSite?.name ?? null,
              fullName: existing.fullName,
              roleTitle: existing.roleTitle,
              isActive: existing.isActive
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
      organizationId: true,
      name: true,
      code: true
    }
  });
}

async function findWorker(organizationId: string, workerId: string) {
  return prisma.worker.findFirst({
    where: {
      id: workerId,
      organizationId
    },
    select: workerSelect
  });
}
