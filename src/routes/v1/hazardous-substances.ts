import {
  DocumentStatus,
  HazardousSubstanceProductStatus,
  HazardousSubstanceStockEventType,
  HazardousSubstanceStorageCheckResult,
  OrganizationRole,
  Prisma
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

const hazardousSubstanceWriteRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert,
  OrganizationRole.worker
];

const hazardousSubstanceAdminRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert
];

const nullableStringSchema = z.union([z.string().trim().min(1), z.null()]);
const productStatusValues = Object.values(HazardousSubstanceProductStatus) as [
  HazardousSubstanceProductStatus,
  ...HazardousSubstanceProductStatus[]
];
const stockEventTypeValues = Object.values(HazardousSubstanceStockEventType) as [
  HazardousSubstanceStockEventType,
  ...HazardousSubstanceStockEventType[]
];
const storageCheckResultValues = Object.values(HazardousSubstanceStorageCheckResult) as [
  HazardousSubstanceStorageCheckResult,
  ...HazardousSubstanceStorageCheckResult[]
];

const productSelect = {
  id: true,
  organizationId: true,
  name: true,
  registrationNumber: true,
  activeIngredient: true,
  targetCrop: true,
  labelRateText: true,
  preHarvestIntervalDays: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.HazardousSubstanceProductSelect;

const useEventSelect = {
  id: true,
  organizationId: true,
  farmSiteId: true,
  plotId: true,
  cropCycleId: true,
  productId: true,
  workerId: true,
  appliedAt: true,
  quantity: true,
  quantityUnit: true,
  reason: true,
  applicationMethod: true,
  targetPest: true,
  weatherNotes: true,
  evidenceDocumentId: true,
  notes: true,
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
  product: {
    select: productSelect
  },
  worker: {
    select: {
      id: true,
      fullName: true,
      roleTitle: true,
      isActive: true
    }
  },
  evidenceDocument: {
    select: {
      id: true,
      status: true,
      fileName: true,
      contentType: true,
      blobSize: true,
      blobSha256: true,
      storageKey: true,
      finalizedAt: true
    }
  }
} satisfies Prisma.HazardousSubstanceUseEventSelect;

const stockEventSelect = {
  id: true,
  organizationId: true,
  productId: true,
  eventType: true,
  occurredAt: true,
  quantity: true,
  quantityUnit: true,
  workerId: true,
  useEventId: true,
  evidenceDocumentId: true,
  reason: true,
  notes: true,
  createdAt: true,
  product: {
    select: productSelect
  },
  worker: {
    select: {
      id: true,
      fullName: true,
      roleTitle: true,
      isActive: true
    }
  },
  evidenceDocument: {
    select: {
      id: true,
      status: true,
      fileName: true,
      contentType: true,
      blobSize: true,
      storageKey: true
    }
  }
} satisfies Prisma.HazardousSubstanceStockEventSelect;

const storageCheckSelect = {
  id: true,
  organizationId: true,
  farmSiteId: true,
  checkedAt: true,
  storageLocation: true,
  checkedByWorkerId: true,
  approvedCropProductsSeparated: true,
  lockedStorage: true,
  labelsReadable: true,
  sdsAvailable: true,
  spillKitAvailable: true,
  result: true,
  issueNotes: true,
  evidenceDocumentId: true,
  createdAt: true,
  updatedAt: true,
  farmSite: {
    select: {
      id: true,
      name: true,
      code: true
    }
  },
  checkedByWorker: {
    select: {
      id: true,
      fullName: true,
      roleTitle: true,
      isActive: true
    }
  },
  evidenceDocument: {
    select: {
      id: true,
      status: true,
      fileName: true,
      contentType: true,
      blobSize: true,
      storageKey: true
    }
  }
} satisfies Prisma.HazardousSubstanceStorageCheckSelect;

type UseEventPayload = Prisma.HazardousSubstanceUseEventGetPayload<{
  select: typeof useEventSelect;
}>;

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  registrationNumber: nullableStringSchema.optional(),
  activeIngredient: nullableStringSchema.optional(),
  targetCrop: nullableStringSchema.optional(),
  labelRateText: nullableStringSchema.optional(),
  preHarvestIntervalDays: z.number().int().nonnegative().optional(),
  status: z.enum(productStatusValues).optional(),
  notes: nullableStringSchema.optional()
});

const updateProductSchema = createProductSchema.partial().refine((payload) => Object.keys(payload).length > 0, {
  message: "At least one field must be provided."
});

const useEventFieldsSchema = z.object({
  plotId: z.string().trim().min(1),
  cropCycleId: nullableStringSchema.optional(),
  productId: z.string().trim().min(1),
  workerId: z.string().trim().min(1),
  appliedAt: z.string().datetime(),
  quantity: z.number().positive(),
  quantityUnit: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(1).max(1000),
  applicationMethod: nullableStringSchema.optional(),
  targetPest: nullableStringSchema.optional(),
  weatherNotes: nullableStringSchema.optional(),
  evidenceDocumentId: z.string().trim().min(1),
  notes: nullableStringSchema.optional()
});

const createUseEventSchema = useEventFieldsSchema;

const updateUseEventSchema = useEventFieldsSchema.partial().refine(
  (payload) => Object.keys(payload).length > 0,
  {
    message: "At least one field must be provided."
  }
);

const createStockEventSchema = z.object({
  productId: z.string().trim().min(1),
  eventType: z.enum(stockEventTypeValues),
  occurredAt: z.string().datetime(),
  quantity: z.number().positive(),
  quantityUnit: z.string().trim().min(1).max(40),
  workerId: nullableStringSchema.optional(),
  useEventId: nullableStringSchema.optional(),
  evidenceDocumentId: nullableStringSchema.optional(),
  reason: nullableStringSchema.optional(),
  notes: nullableStringSchema.optional()
});

const createStorageCheckSchema = z.object({
  farmSiteId: nullableStringSchema.optional(),
  checkedAt: z.string().datetime(),
  storageLocation: z.string().trim().min(1).max(240),
  checkedByWorkerId: nullableStringSchema.optional(),
  approvedCropProductsSeparated: z.boolean(),
  lockedStorage: z.boolean(),
  labelsReadable: z.boolean(),
  sdsAvailable: z.boolean(),
  spillKitAvailable: z.boolean().optional(),
  result: z.enum(storageCheckResultValues),
  issueNotes: nullableStringSchema.optional(),
  evidenceDocumentId: nullableStringSchema.optional()
});

const listProductQuerySchema = z.object({
  status: z.enum(productStatusValues).optional(),
  q: z.string().trim().min(1).optional()
});

const listUseEventsQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional(),
  plotId: z.string().trim().min(1).optional(),
  cropCycleId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  workerId: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const listStockEventsQuerySchema = z.object({
  productId: z.string().trim().min(1).optional(),
  eventType: z.enum(stockEventTypeValues).optional(),
  useEventId: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const listStorageChecksQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional(),
  result: z.enum(storageCheckResultValues).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export const hazardousSubstancesRouter = Router();

hazardousSubstancesRouter.use(requireTenantContext);

hazardousSubstancesRouter.get("/products", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listProductQuerySchema.parse(req.query);
    const items = await prisma.hazardousSubstanceProduct.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.q
          ? {
              OR: [
                { name: { contains: filters.q, mode: "insensitive" } },
                { activeIngredient: { contains: filters.q, mode: "insensitive" } },
                { registrationNumber: { contains: filters.q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 200,
      select: productSelect
    });

    res.json({
      items,
      organizationId: tenant.organizationId,
      filters: {
        status: filters.status ?? null,
        q: filters.q ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.get("/products/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const product = await findProduct(tenant.organizationId, String(req.params.id));

    if (!product) {
      return res.status(404).json({
        error: {
          code: "hazardous_substance_product_not_found",
          message: "Hazardous substance product was not found in the active organization."
        }
      });
    }

    res.json({ item: product });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.post(
  "/products",
  requireOrganizationRole(hazardousSubstanceAdminRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createProductSchema.parse(req.body);

      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.hazardousSubstanceProduct.create({
          data: {
            organizationId: tenant.organizationId,
            name: payload.name,
            registrationNumber: payload.registrationNumber ?? null,
            activeIngredient: payload.activeIngredient ?? null,
            targetCrop: payload.targetCrop ?? null,
            labelRateText: payload.labelRateText ?? null,
            preHarvestIntervalDays: payload.preHarvestIntervalDays ?? null,
            status: payload.status ?? HazardousSubstanceProductStatus.active,
            notes: payload.notes ?? null
          },
          select: productSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "hazardous_substance_product",
            entityId: created.id,
            action: "hazardous_substance_product.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              name: created.name,
              registrationNumber: created.registrationNumber,
              status: created.status
            }
          }
        });

        return created;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

hazardousSubstancesRouter.patch(
  "/products/:id",
  requireOrganizationRole(hazardousSubstanceAdminRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const productId = String(req.params.id);
      const payload = updateProductSchema.parse(req.body);
      const existing = await findProduct(tenant.organizationId, productId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "hazardous_substance_product_not_found",
            message: "Hazardous substance product was not found in the active organization."
          }
        });
      }

      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.hazardousSubstanceProduct.update({
          where: { id: existing.id },
          data: {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.registrationNumber !== undefined
              ? { registrationNumber: payload.registrationNumber }
              : {}),
            ...(payload.activeIngredient !== undefined
              ? { activeIngredient: payload.activeIngredient }
              : {}),
            ...(payload.targetCrop !== undefined ? { targetCrop: payload.targetCrop } : {}),
            ...(payload.labelRateText !== undefined
              ? { labelRateText: payload.labelRateText }
              : {}),
            ...(payload.preHarvestIntervalDays !== undefined
              ? { preHarvestIntervalDays: payload.preHarvestIntervalDays }
              : {}),
            ...(payload.status !== undefined ? { status: payload.status } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {})
          },
          select: productSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "hazardous_substance_product",
            entityId: existing.id,
            action: "hazardous_substance_product.updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousStatus: existing.status,
              nextStatus: updated.status,
              previousName: existing.name,
              nextName: updated.name
            }
          }
        });

        return updated;
      });

      res.json({ item });
    } catch (error) {
      next(error);
    }
  }
);

hazardousSubstancesRouter.get("/use-events", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listUseEventsQuerySchema.parse(req.query);
    const items = await prisma.hazardousSubstanceUseEvent.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.farmSiteId ? { farmSiteId: filters.farmSiteId } : {}),
        ...(filters.plotId ? { plotId: filters.plotId } : {}),
        ...(filters.cropCycleId ? { cropCycleId: filters.cropCycleId } : {}),
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.workerId ? { workerId: filters.workerId } : {}),
        ...(filters.from || filters.to
          ? {
              appliedAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {})
              }
            }
          : {})
      },
      orderBy: [{ appliedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: useEventSelect
    });

    res.json({
      items,
      organizationId: tenant.organizationId,
      filters: {
        farmSiteId: filters.farmSiteId ?? null,
        plotId: filters.plotId ?? null,
        cropCycleId: filters.cropCycleId ?? null,
        productId: filters.productId ?? null,
        workerId: filters.workerId ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.get("/use-events/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const item = await findUseEvent(tenant.organizationId, String(req.params.id));

    if (!item) {
      return res.status(404).json({
        error: {
          code: "hazardous_substance_use_event_not_found",
          message: "Hazardous substance use event was not found in the active organization."
        }
      });
    }

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.post(
  "/use-events",
  requireOrganizationRole(hazardousSubstanceWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createUseEventSchema.parse(req.body);
      const resolution = await resolveUseEventReferences(tenant.organizationId, {
        plotId: payload.plotId,
        cropCycleId: payload.cropCycleId ?? null,
        productId: payload.productId,
        workerId: payload.workerId,
        evidenceDocumentId: payload.evidenceDocumentId
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({ error: resolution.error });
      }

      const appliedAt = new Date(payload.appliedAt);
      const item = await prisma.$transaction(async (tx): Promise<UseEventPayload> => {
        const created = await tx.hazardousSubstanceUseEvent.create({
          data: {
            organizationId: tenant.organizationId,
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot.id,
            cropCycleId: resolution.cropCycle?.id ?? null,
            productId: resolution.product.id,
            workerId: resolution.worker.id,
            appliedAt,
            quantity: payload.quantity,
            quantityUnit: payload.quantityUnit,
            reason: payload.reason,
            applicationMethod: payload.applicationMethod ?? null,
            targetPest: payload.targetPest ?? null,
            weatherNotes: payload.weatherNotes ?? null,
            evidenceDocumentId: resolution.document.id,
            notes: payload.notes ?? null
          },
          select: useEventSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "hazardous_substance_use_event",
            entityId: created.id,
            action: "hazardous_substance_use_event.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: created.farmSiteId,
              plotId: created.plotId,
              cropCycleId: created.cropCycleId,
              productId: created.productId,
              workerId: created.workerId,
              appliedAt: created.appliedAt.toISOString(),
              quantity: created.quantity,
              quantityUnit: created.quantityUnit,
              reason: created.reason,
              evidenceDocumentId: created.evidenceDocumentId
            }
          }
        });

        return created;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

hazardousSubstancesRouter.patch(
  "/use-events/:id",
  requireOrganizationRole(hazardousSubstanceWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const useEventId = String(req.params.id);
      const payload = updateUseEventSchema.parse(req.body);
      const existing = await findUseEvent(tenant.organizationId, useEventId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "hazardous_substance_use_event_not_found",
            message: "Hazardous substance use event was not found in the active organization."
          }
        });
      }

      const resolution = await resolveUseEventReferences(tenant.organizationId, {
        plotId: payload.plotId ?? existing.plotId,
        cropCycleId: payload.cropCycleId !== undefined ? payload.cropCycleId : existing.cropCycleId,
        productId: payload.productId ?? existing.productId,
        workerId: payload.workerId ?? existing.workerId,
        evidenceDocumentId: payload.evidenceDocumentId ?? existing.evidenceDocumentId,
        allowInactiveProductId:
          payload.productId === undefined ? existing.productId : undefined
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({ error: resolution.error });
      }

      const item = await prisma.$transaction(async (tx): Promise<UseEventPayload> => {
        const updated = await tx.hazardousSubstanceUseEvent.update({
          where: { id: existing.id },
          data: {
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot.id,
            cropCycleId: resolution.cropCycle?.id ?? null,
            productId: resolution.product.id,
            workerId: resolution.worker.id,
            evidenceDocumentId: resolution.document.id,
            ...(payload.appliedAt !== undefined ? { appliedAt: new Date(payload.appliedAt) } : {}),
            ...(payload.quantity !== undefined ? { quantity: payload.quantity } : {}),
            ...(payload.quantityUnit !== undefined ? { quantityUnit: payload.quantityUnit } : {}),
            ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
            ...(payload.applicationMethod !== undefined
              ? { applicationMethod: payload.applicationMethod }
              : {}),
            ...(payload.targetPest !== undefined ? { targetPest: payload.targetPest } : {}),
            ...(payload.weatherNotes !== undefined ? { weatherNotes: payload.weatherNotes } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {})
          },
          select: useEventSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "hazardous_substance_use_event",
            entityId: existing.id,
            action: "hazardous_substance_use_event.updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousPlotId: existing.plotId,
              nextPlotId: updated.plotId,
              previousProductId: existing.productId,
              nextProductId: updated.productId,
              previousWorkerId: existing.workerId,
              nextWorkerId: updated.workerId,
              previousAppliedAt: existing.appliedAt.toISOString(),
              nextAppliedAt: updated.appliedAt.toISOString(),
              previousQuantity: existing.quantity,
              nextQuantity: updated.quantity,
              previousQuantityUnit: existing.quantityUnit,
              nextQuantityUnit: updated.quantityUnit,
              previousEvidenceDocumentId: existing.evidenceDocumentId,
              nextEvidenceDocumentId: updated.evidenceDocumentId
            }
          }
        });

        return updated;
      });

      res.json({ item });
    } catch (error) {
      next(error);
    }
  }
);

hazardousSubstancesRouter.get("/stock-events", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listStockEventsQuerySchema.parse(req.query);
    const items = await prisma.hazardousSubstanceStockEvent.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.eventType ? { eventType: filters.eventType } : {}),
        ...(filters.useEventId ? { useEventId: filters.useEventId } : {}),
        ...(filters.from || filters.to
          ? {
              occurredAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {})
              }
            }
          : {})
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: stockEventSelect
    });

    res.json({
      items,
      organizationId: tenant.organizationId,
      filters: {
        productId: filters.productId ?? null,
        eventType: filters.eventType ?? null,
        useEventId: filters.useEventId ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.get("/stock-events/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const item = await prisma.hazardousSubstanceStockEvent.findFirst({
      where: { id: String(req.params.id), organizationId: tenant.organizationId },
      select: stockEventSelect
    });

    if (!item) {
      return res.status(404).json({
        error: {
          code: "hazardous_substance_stock_event_not_found",
          message: "Hazardous substance stock event was not found in the active organization."
        }
      });
    }

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.post(
  "/stock-events",
  requireOrganizationRole(hazardousSubstanceWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createStockEventSchema.parse(req.body);
      const resolution = await resolveStockEventReferences(tenant.organizationId, payload);

      if (!resolution.ok) {
        return res.status(resolution.status).json({ error: resolution.error });
      }

      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.hazardousSubstanceStockEvent.create({
          data: {
            organizationId: tenant.organizationId,
            productId: resolution.product.id,
            eventType: payload.eventType,
            occurredAt: new Date(payload.occurredAt),
            quantity: payload.quantity,
            quantityUnit: payload.quantityUnit,
            workerId: resolution.worker?.id ?? null,
            useEventId: resolution.useEvent?.id ?? null,
            evidenceDocumentId: resolution.document?.id ?? null,
            reason: payload.reason ?? null,
            notes: payload.notes ?? null
          },
          select: stockEventSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "hazardous_substance_stock_event",
            entityId: created.id,
            action: "hazardous_substance_stock_event.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              productId: created.productId,
              eventType: created.eventType,
              occurredAt: created.occurredAt.toISOString(),
              quantity: created.quantity,
              quantityUnit: created.quantityUnit,
              workerId: created.workerId,
              useEventId: created.useEventId,
              evidenceDocumentId: created.evidenceDocumentId
            }
          }
        });

        return created;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

hazardousSubstancesRouter.get("/storage-checks", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listStorageChecksQuerySchema.parse(req.query);
    const items = await prisma.hazardousSubstanceStorageCheck.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.farmSiteId ? { farmSiteId: filters.farmSiteId } : {}),
        ...(filters.result ? { result: filters.result } : {}),
        ...(filters.from || filters.to
          ? {
              checkedAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {})
              }
            }
          : {})
      },
      orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: storageCheckSelect
    });

    res.json({
      items,
      organizationId: tenant.organizationId,
      filters: {
        farmSiteId: filters.farmSiteId ?? null,
        result: filters.result ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.get("/storage-checks/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const item = await prisma.hazardousSubstanceStorageCheck.findFirst({
      where: { id: String(req.params.id), organizationId: tenant.organizationId },
      select: storageCheckSelect
    });

    if (!item) {
      return res.status(404).json({
        error: {
          code: "hazardous_substance_storage_check_not_found",
          message: "Hazardous substance storage check was not found in the active organization."
        }
      });
    }

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

hazardousSubstancesRouter.post(
  "/storage-checks",
  requireOrganizationRole(hazardousSubstanceWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createStorageCheckSchema.parse(req.body);
      const resolution = await resolveStorageCheckReferences(tenant.organizationId, payload);

      if (!resolution.ok) {
        return res.status(resolution.status).json({ error: resolution.error });
      }

      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.hazardousSubstanceStorageCheck.create({
          data: {
            organizationId: tenant.organizationId,
            farmSiteId: resolution.farmSite?.id ?? null,
            checkedAt: new Date(payload.checkedAt),
            storageLocation: payload.storageLocation,
            checkedByWorkerId: resolution.worker?.id ?? null,
            approvedCropProductsSeparated: payload.approvedCropProductsSeparated,
            lockedStorage: payload.lockedStorage,
            labelsReadable: payload.labelsReadable,
            sdsAvailable: payload.sdsAvailable,
            spillKitAvailable: payload.spillKitAvailable ?? null,
            result: payload.result,
            issueNotes: payload.issueNotes ?? null,
            evidenceDocumentId: resolution.document?.id ?? null
          },
          select: storageCheckSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "hazardous_substance_storage_check",
            entityId: created.id,
            action: "hazardous_substance_storage_check.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              farmSiteId: created.farmSiteId,
              checkedAt: created.checkedAt.toISOString(),
              storageLocation: created.storageLocation,
              checkedByWorkerId: created.checkedByWorkerId,
              result: created.result,
              evidenceDocumentId: created.evidenceDocumentId
            }
          }
        });

        return created;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

async function findProduct(organizationId: string, productId: string) {
  return prisma.hazardousSubstanceProduct.findFirst({
    where: { id: productId, organizationId },
    select: productSelect
  });
}

async function findUseEvent(organizationId: string, useEventId: string) {
  return prisma.hazardousSubstanceUseEvent.findFirst({
    where: { id: useEventId, organizationId },
    select: useEventSelect
  });
}

async function resolveUseEventReferences(
  organizationId: string,
  input: {
    plotId: string;
    cropCycleId: string | null;
    productId: string;
    workerId: string;
    evidenceDocumentId: string;
    allowInactiveProductId?: string;
  }
) {
  const plot = await prisma.plot.findFirst({
    where: {
      id: input.plotId,
      farmSite: {
        organizationId
      }
    },
    select: {
      id: true,
      name: true,
      farmSiteId: true,
      farmSite: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  if (!plot) {
    return notFound("plot_not_found", "Plot was not found in the active organization.");
  }

  const cropCycle = input.cropCycleId
    ? await prisma.cropCycle.findFirst({
        where: {
          id: input.cropCycleId,
          organizationId
        },
        select: {
          id: true,
          farmSiteId: true,
          plotId: true
        }
      })
    : null;

  if (input.cropCycleId && !cropCycle) {
    return notFound("crop_cycle_not_found", "Crop cycle was not found in the active organization.");
  }

  if (cropCycle && cropCycle.farmSiteId !== plot.farmSiteId) {
    return conflict(
      "hazardous_substance_context_conflict",
      "Crop cycle does not belong to the selected plot's farm site."
    );
  }

  if (cropCycle?.plotId && cropCycle.plotId !== plot.id) {
    return conflict(
      "hazardous_substance_context_conflict",
      "Crop cycle does not belong to the selected plot."
    );
  }

  const product = await prisma.hazardousSubstanceProduct.findFirst({
    where: {
      id: input.productId,
      organizationId
    },
    select: {
      id: true,
      name: true,
      status: true
    }
  });

  if (!product) {
    return notFound(
      "hazardous_substance_product_not_found",
      "Hazardous substance product was not found in the active organization."
    );
  }

  if (
    product.status !== HazardousSubstanceProductStatus.active &&
    input.allowInactiveProductId !== product.id
  ) {
    return conflict(
      "hazardous_substance_product_inactive",
      "Only active hazardous substance products can be used in a new or retargeted use record."
    );
  }

  const worker = await prisma.worker.findFirst({
    where: {
      id: input.workerId,
      organizationId
    },
    select: {
      id: true,
      fullName: true,
      farmSiteId: true,
      isActive: true
    }
  });

  if (!worker) {
    return notFound("worker_not_found", "Worker was not found in the active organization.");
  }

  if (!worker.isActive) {
    return conflict(
      "worker_inactive",
      "Hazardous substance use records require an active operator."
    );
  }

  if (worker.farmSiteId && worker.farmSiteId !== plot.farmSiteId) {
    return conflict(
      "hazardous_substance_context_conflict",
      "Worker is assigned to a different farm site."
    );
  }

  const document = await findReadyDocument(organizationId, input.evidenceDocumentId);
  if (!document) {
    return notFound("document_not_found", "Evidence document was not found in the active organization.");
  }
  if (document.status !== DocumentStatus.ready) {
    return conflict(
      "document_not_ready",
      "Evidence document must be in 'ready' status before it can support a hazardous substance record."
    );
  }

  return {
    ok: true as const,
    farmSite: plot.farmSite,
    plot,
    cropCycle,
    product,
    worker,
    document
  };
}

async function resolveStockEventReferences(
  organizationId: string,
  input: z.infer<typeof createStockEventSchema>
) {
  const product = await prisma.hazardousSubstanceProduct.findFirst({
    where: { id: input.productId, organizationId },
    select: { id: true, status: true }
  });

  if (!product) {
    return notFound(
      "hazardous_substance_product_not_found",
      "Hazardous substance product was not found in the active organization."
    );
  }

  const worker = input.workerId
    ? await prisma.worker.findFirst({
        where: { id: input.workerId, organizationId },
        select: { id: true, isActive: true }
      })
    : null;

  if (input.workerId && !worker) {
    return notFound("worker_not_found", "Worker was not found in the active organization.");
  }

  const useEvent = input.useEventId
    ? await prisma.hazardousSubstanceUseEvent.findFirst({
        where: { id: input.useEventId, organizationId },
        select: { id: true, productId: true }
      })
    : null;

  if (input.useEventId && !useEvent) {
    return notFound(
      "hazardous_substance_use_event_not_found",
      "Hazardous substance use event was not found in the active organization."
    );
  }

  if (useEvent && useEvent.productId !== product.id) {
    return conflict(
      "hazardous_substance_context_conflict",
      "Stock event product must match the linked use event product."
    );
  }

  const document = input.evidenceDocumentId
    ? await findReadyDocument(organizationId, input.evidenceDocumentId)
    : null;

  if (input.evidenceDocumentId && !document) {
    return notFound("document_not_found", "Evidence document was not found in the active organization.");
  }
  if (document && document.status !== DocumentStatus.ready) {
    return conflict(
      "document_not_ready",
      "Evidence document must be in 'ready' status before it can support a stock event."
    );
  }

  return {
    ok: true as const,
    product,
    worker,
    useEvent,
    document
  };
}

async function resolveStorageCheckReferences(
  organizationId: string,
  input: z.infer<typeof createStorageCheckSchema>
) {
  const farmSite = input.farmSiteId
    ? await prisma.farmSite.findFirst({
        where: { id: input.farmSiteId, organizationId },
        select: { id: true, name: true }
      })
    : null;

  if (input.farmSiteId && !farmSite) {
    return notFound("farm_site_not_found", "Farm site was not found in the active organization.");
  }

  const worker = input.checkedByWorkerId
    ? await prisma.worker.findFirst({
        where: { id: input.checkedByWorkerId, organizationId },
        select: { id: true, farmSiteId: true, isActive: true }
      })
    : null;

  if (input.checkedByWorkerId && !worker) {
    return notFound("worker_not_found", "Worker was not found in the active organization.");
  }

  if (farmSite && worker?.farmSiteId && worker.farmSiteId !== farmSite.id) {
    return conflict(
      "hazardous_substance_context_conflict",
      "Storage check worker is assigned to a different farm site."
    );
  }

  const document = input.evidenceDocumentId
    ? await findReadyDocument(organizationId, input.evidenceDocumentId)
    : null;

  if (input.evidenceDocumentId && !document) {
    return notFound("document_not_found", "Evidence document was not found in the active organization.");
  }
  if (document && document.status !== DocumentStatus.ready) {
    return conflict(
      "document_not_ready",
      "Evidence document must be in 'ready' status before it can support a storage check."
    );
  }

  return {
    ok: true as const,
    farmSite,
    worker,
    document
  };
}

async function findReadyDocument(organizationId: string, documentId: string) {
  return prisma.document.findFirst({
    where: {
      id: documentId,
      organizationId
    },
    select: {
      id: true,
      status: true,
      fileName: true,
      contentType: true,
      blobSize: true,
      storageKey: true
    }
  });
}

function notFound(code: string, message: string) {
  return {
    ok: false as const,
    status: 404,
    error: {
      code,
      message
    }
  };
}

function conflict(code: string, message: string) {
  return {
    ok: false as const,
    status: 409,
    error: {
      code,
      message
    }
  };
}
