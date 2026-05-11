import {
  DocumentStatus,
  FertilizerProductStatus,
  FertilizerType,
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

const fertilizerWriteRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert,
  OrganizationRole.worker
];

const fertilizerAdminRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert
];

const nullableStringSchema = z.union([z.string().trim().min(1), z.null()]);
const fertilizerStatusValues = Object.values(FertilizerProductStatus) as [
  FertilizerProductStatus,
  ...FertilizerProductStatus[]
];
const fertilizerTypeValues = Object.values(FertilizerType) as [
  FertilizerType,
  ...FertilizerType[]
];
const nullableNutrientSchema = z.union([z.number().nonnegative(), z.null()]);
const optionalPositiveNumberSchema = z.union([z.number().positive(), z.null()]);

const productSelect = {
  id: true,
  organizationId: true,
  name: true,
  type: true,
  formulaLabelText: true,
  nutrientN: true,
  nutrientP: true,
  nutrientK: true,
  sourceOrSupplier: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.FertilizerProductSelect;

const applicationSelect = {
  id: true,
  organizationId: true,
  farmSiteId: true,
  plotId: true,
  cropCycleId: true,
  productId: true,
  workerId: true,
  evidenceDocumentId: true,
  appliedAt: true,
  fertilizerName: true,
  fertilizerType: true,
  formulaLabelText: true,
  nutrientN: true,
  nutrientP: true,
  nutrientK: true,
  quantity: true,
  quantityUnit: true,
  applicationMethod: true,
  treatedArea: true,
  treatedAreaUnit: true,
  operatorName: true,
  reasonOrGrowthStage: true,
  sourceOrSupplier: true,
  lotNo: true,
  waterVolume: true,
  waterVolumeUnit: true,
  equipmentName: true,
  weatherNotes: true,
  notes: true,
  supersedesRecordId: true,
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
  },
  supersedesRecord: {
    select: {
      id: true,
      appliedAt: true,
      fertilizerName: true
    }
  }
} satisfies Prisma.FertilizerApplicationSelect;

type ApplicationPayload = Prisma.FertilizerApplicationGetPayload<{
  select: typeof applicationSelect;
}>;

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(fertilizerTypeValues).optional(),
  formulaLabelText: nullableStringSchema.optional(),
  nutrientN: nullableNutrientSchema.optional(),
  nutrientP: nullableNutrientSchema.optional(),
  nutrientK: nullableNutrientSchema.optional(),
  sourceOrSupplier: nullableStringSchema.optional(),
  status: z.enum(fertilizerStatusValues).optional(),
  notes: nullableStringSchema.optional()
});

const updateProductSchema = createProductSchema.partial().refine(
  (payload) => Object.keys(payload).length > 0,
  {
    message: "At least one field must be provided."
  }
);

const applicationFieldsSchema = z.object({
  plotId: z.string().trim().min(1),
  cropCycleId: z.string().trim().min(1),
  productId: nullableStringSchema.optional(),
  workerId: nullableStringSchema.optional(),
  evidenceDocumentId: nullableStringSchema.optional(),
  appliedAt: z.string().datetime(),
  fertilizerName: z.string().trim().min(1).max(160),
  fertilizerType: z.enum(fertilizerTypeValues),
  formulaLabelText: nullableStringSchema.optional(),
  nutrientN: nullableNutrientSchema.optional(),
  nutrientP: nullableNutrientSchema.optional(),
  nutrientK: nullableNutrientSchema.optional(),
  quantity: z.number().positive(),
  quantityUnit: z.string().trim().min(1).max(40),
  applicationMethod: z.string().trim().min(1).max(120),
  treatedArea: z.number().positive(),
  treatedAreaUnit: z.string().trim().min(1).max(40),
  operatorName: nullableStringSchema.optional(),
  reasonOrGrowthStage: z.string().trim().min(1).max(1000),
  sourceOrSupplier: nullableStringSchema.optional(),
  lotNo: nullableStringSchema.optional(),
  waterVolume: optionalPositiveNumberSchema.optional(),
  waterVolumeUnit: nullableStringSchema.optional(),
  equipmentName: nullableStringSchema.optional(),
  weatherNotes: nullableStringSchema.optional(),
  notes: nullableStringSchema.optional(),
  supersedesRecordId: nullableStringSchema.optional()
});

const createApplicationSchema = applicationFieldsSchema.refine(
  (payload) => Boolean(payload.workerId || payload.operatorName),
  {
    message: "Either workerId or operatorName must be provided.",
    path: ["operatorName"]
  }
);

const updateApplicationSchema = applicationFieldsSchema.partial().refine(
  (payload) =>
    Object.keys(payload).length > 0 &&
    (payload.workerId !== null || payload.operatorName !== null),
  {
    message: "At least one field must be provided, and workerId/operatorName cannot both be cleared."
  }
);

const listProductQuerySchema = z.object({
  status: z.enum(fertilizerStatusValues).optional(),
  type: z.enum(fertilizerTypeValues).optional(),
  q: z.string().trim().min(1).optional()
});

const listApplicationQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional(),
  plotId: z.string().trim().min(1).optional(),
  cropCycleId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  workerId: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export const fertilizersRouter = Router();

fertilizersRouter.use(requireTenantContext);

fertilizersRouter.get("/products", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listProductQuerySchema.parse(req.query);
    const items = await prisma.fertilizerProduct.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.q
          ? {
              OR: [
                { name: { contains: filters.q, mode: "insensitive" } },
                { formulaLabelText: { contains: filters.q, mode: "insensitive" } },
                { sourceOrSupplier: { contains: filters.q, mode: "insensitive" } }
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
        type: filters.type ?? null,
        q: filters.q ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

fertilizersRouter.get("/products/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const item = await findProduct(tenant.organizationId, String(req.params.id));

    if (!item) {
      return res.status(404).json({
        error: {
          code: "fertilizer_product_not_found",
          message: "Fertilizer product was not found in the active organization."
        }
      });
    }

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

fertilizersRouter.post(
  "/products",
  requireOrganizationRole(fertilizerAdminRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createProductSchema.parse(req.body);

      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.fertilizerProduct.create({
          data: {
            organizationId: tenant.organizationId,
            name: payload.name,
            type: payload.type ?? FertilizerType.other,
            formulaLabelText: payload.formulaLabelText ?? null,
            nutrientN: payload.nutrientN ?? null,
            nutrientP: payload.nutrientP ?? null,
            nutrientK: payload.nutrientK ?? null,
            sourceOrSupplier: payload.sourceOrSupplier ?? null,
            status: payload.status ?? FertilizerProductStatus.active,
            notes: payload.notes ?? null
          },
          select: productSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "fertilizer_product",
            entityId: created.id,
            action: "fertilizer_product.created",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              name: created.name,
              type: created.type,
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

fertilizersRouter.patch(
  "/products/:id",
  requireOrganizationRole(fertilizerAdminRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const productId = String(req.params.id);
      const payload = updateProductSchema.parse(req.body);
      const existing = await findProduct(tenant.organizationId, productId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "fertilizer_product_not_found",
            message: "Fertilizer product was not found in the active organization."
          }
        });
      }

      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.fertilizerProduct.update({
          where: { id: existing.id },
          data: {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.type !== undefined ? { type: payload.type } : {}),
            ...(payload.formulaLabelText !== undefined
              ? { formulaLabelText: payload.formulaLabelText }
              : {}),
            ...(payload.nutrientN !== undefined ? { nutrientN: payload.nutrientN } : {}),
            ...(payload.nutrientP !== undefined ? { nutrientP: payload.nutrientP } : {}),
            ...(payload.nutrientK !== undefined ? { nutrientK: payload.nutrientK } : {}),
            ...(payload.sourceOrSupplier !== undefined
              ? { sourceOrSupplier: payload.sourceOrSupplier }
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
            entityType: "fertilizer_product",
            entityId: existing.id,
            action: "fertilizer_product.updated",
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

fertilizersRouter.get("/applications", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listApplicationQuerySchema.parse(req.query);
    const items = await prisma.fertilizerApplication.findMany({
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
      select: applicationSelect
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

fertilizersRouter.get("/applications/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const item = await findApplication(tenant.organizationId, String(req.params.id));

    if (!item) {
      return res.status(404).json({
        error: {
          code: "fertilizer_application_not_found",
          message: "Fertilizer application record was not found in the active organization."
        }
      });
    }

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

fertilizersRouter.post(
  "/applications",
  requireOrganizationRole(fertilizerWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createApplicationSchema.parse(req.body);
      const resolution = await resolveApplicationReferences(tenant.organizationId, {
        plotId: payload.plotId,
        cropCycleId: payload.cropCycleId,
        productId: payload.productId ?? null,
        workerId: payload.workerId ?? null,
        evidenceDocumentId: payload.evidenceDocumentId ?? null,
        supersedesRecordId: payload.supersedesRecordId ?? null
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({ error: resolution.error });
      }

      const item = await prisma.$transaction(async (tx): Promise<ApplicationPayload> => {
        const created = await tx.fertilizerApplication.create({
          data: {
            organizationId: tenant.organizationId,
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot.id,
            cropCycleId: resolution.cropCycle.id,
            productId: resolution.product?.id ?? null,
            workerId: resolution.worker?.id ?? null,
            evidenceDocumentId: resolution.document?.id ?? null,
            supersedesRecordId: resolution.supersedesRecord?.id ?? null,
            appliedAt: new Date(payload.appliedAt),
            fertilizerName: payload.fertilizerName,
            fertilizerType: payload.fertilizerType,
            formulaLabelText: payload.formulaLabelText ?? null,
            nutrientN: payload.nutrientN ?? null,
            nutrientP: payload.nutrientP ?? null,
            nutrientK: payload.nutrientK ?? null,
            quantity: payload.quantity,
            quantityUnit: payload.quantityUnit,
            applicationMethod: payload.applicationMethod,
            treatedArea: payload.treatedArea,
            treatedAreaUnit: payload.treatedAreaUnit,
            operatorName: payload.operatorName ?? resolution.worker?.fullName ?? "Unknown operator",
            reasonOrGrowthStage: payload.reasonOrGrowthStage,
            sourceOrSupplier: payload.sourceOrSupplier ?? null,
            lotNo: payload.lotNo ?? null,
            waterVolume: payload.waterVolume ?? null,
            waterVolumeUnit: payload.waterVolumeUnit ?? null,
            equipmentName: payload.equipmentName ?? null,
            weatherNotes: payload.weatherNotes ?? null,
            notes: payload.notes ?? null
          },
          select: applicationSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "fertilizer_application",
            entityId: created.id,
            action: "fertilizer_application.created",
            payloadJson: auditApplicationPayload(tenant, created)
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

fertilizersRouter.patch(
  "/applications/:id",
  requireOrganizationRole(fertilizerWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const applicationId = String(req.params.id);
      const payload = updateApplicationSchema.parse(req.body);
      const existing = await findApplication(tenant.organizationId, applicationId);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "fertilizer_application_not_found",
            message: "Fertilizer application record was not found in the active organization."
          }
        });
      }

      const resolution = await resolveApplicationReferences(tenant.organizationId, {
        plotId: payload.plotId ?? existing.plotId,
        cropCycleId:
          payload.cropCycleId !== undefined ? payload.cropCycleId : existing.cropCycleId,
        productId: payload.productId !== undefined ? payload.productId : existing.productId,
        workerId: payload.workerId !== undefined ? payload.workerId : existing.workerId,
        evidenceDocumentId:
          payload.evidenceDocumentId !== undefined
            ? payload.evidenceDocumentId
            : existing.evidenceDocumentId,
        supersedesRecordId:
          payload.supersedesRecordId !== undefined
            ? payload.supersedesRecordId
            : existing.supersedesRecordId,
        allowInactiveProductId:
          payload.productId === undefined ? existing.productId ?? undefined : undefined,
        currentApplicationId: existing.id
      });

      if (!resolution.ok) {
        return res.status(resolution.status).json({ error: resolution.error });
      }

      const item = await prisma.$transaction(async (tx): Promise<ApplicationPayload> => {
        const updated = await tx.fertilizerApplication.update({
          where: { id: existing.id },
          data: {
            farmSiteId: resolution.farmSite.id,
            plotId: resolution.plot.id,
            cropCycleId: resolution.cropCycle.id,
            productId: resolution.product?.id ?? null,
            workerId: resolution.worker?.id ?? null,
            evidenceDocumentId: resolution.document?.id ?? null,
            supersedesRecordId: resolution.supersedesRecord?.id ?? null,
            ...(payload.appliedAt !== undefined ? { appliedAt: new Date(payload.appliedAt) } : {}),
            ...(payload.fertilizerName !== undefined
              ? { fertilizerName: payload.fertilizerName }
              : {}),
            ...(payload.fertilizerType !== undefined
              ? { fertilizerType: payload.fertilizerType }
              : {}),
            ...(payload.formulaLabelText !== undefined
              ? { formulaLabelText: payload.formulaLabelText }
              : {}),
            ...(payload.nutrientN !== undefined ? { nutrientN: payload.nutrientN } : {}),
            ...(payload.nutrientP !== undefined ? { nutrientP: payload.nutrientP } : {}),
            ...(payload.nutrientK !== undefined ? { nutrientK: payload.nutrientK } : {}),
            ...(payload.quantity !== undefined ? { quantity: payload.quantity } : {}),
            ...(payload.quantityUnit !== undefined ? { quantityUnit: payload.quantityUnit } : {}),
            ...(payload.applicationMethod !== undefined
              ? { applicationMethod: payload.applicationMethod }
              : {}),
            ...(payload.treatedArea !== undefined ? { treatedArea: payload.treatedArea } : {}),
            ...(payload.treatedAreaUnit !== undefined
              ? { treatedAreaUnit: payload.treatedAreaUnit }
              : {}),
            ...(payload.operatorName !== undefined || payload.workerId !== undefined
              ? { operatorName: payload.operatorName ?? resolution.worker?.fullName ?? existing.operatorName }
              : {}),
            ...(payload.reasonOrGrowthStage !== undefined
              ? { reasonOrGrowthStage: payload.reasonOrGrowthStage }
              : {}),
            ...(payload.sourceOrSupplier !== undefined
              ? { sourceOrSupplier: payload.sourceOrSupplier }
              : {}),
            ...(payload.lotNo !== undefined ? { lotNo: payload.lotNo } : {}),
            ...(payload.waterVolume !== undefined ? { waterVolume: payload.waterVolume } : {}),
            ...(payload.waterVolumeUnit !== undefined
              ? { waterVolumeUnit: payload.waterVolumeUnit }
              : {}),
            ...(payload.equipmentName !== undefined ? { equipmentName: payload.equipmentName } : {}),
            ...(payload.weatherNotes !== undefined ? { weatherNotes: payload.weatherNotes } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {})
          },
          select: applicationSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "fertilizer_application",
            entityId: existing.id,
            action: "fertilizer_application.updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousPlotId: existing.plotId,
              nextPlotId: updated.plotId,
              previousProductId: existing.productId,
              nextProductId: updated.productId,
              previousAppliedAt: existing.appliedAt.toISOString(),
              nextAppliedAt: updated.appliedAt.toISOString(),
              previousQuantity: existing.quantity,
              nextQuantity: updated.quantity,
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

async function findProduct(organizationId: string, productId: string) {
  return prisma.fertilizerProduct.findFirst({
    where: { id: productId, organizationId },
    select: productSelect
  });
}

async function findApplication(organizationId: string, applicationId: string) {
  return prisma.fertilizerApplication.findFirst({
    where: { id: applicationId, organizationId },
    select: applicationSelect
  });
}

async function resolveApplicationReferences(
  organizationId: string,
  input: {
    plotId: string;
    cropCycleId: string;
    productId: string | null;
    workerId: string | null;
    evidenceDocumentId: string | null;
    supersedesRecordId: string | null;
    allowInactiveProductId?: string;
    currentApplicationId?: string;
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

  const cropCycle = await prisma.cropCycle.findFirst({
    where: {
      id: input.cropCycleId,
      organizationId
    },
    select: {
      id: true,
      farmSiteId: true,
      plotId: true
    }
  });

  if (!cropCycle) {
    return notFound("crop_cycle_not_found", "Crop cycle was not found in the active organization.");
  }

  if (cropCycle.farmSiteId !== plot.farmSiteId) {
    return conflict(
      "fertilizer_context_conflict",
      "Crop cycle does not belong to the selected plot's farm site."
    );
  }

  if (cropCycle.plotId && cropCycle.plotId !== plot.id) {
    return conflict(
      "fertilizer_context_conflict",
      "Crop cycle does not belong to the selected plot."
    );
  }

  const product = input.productId
    ? await prisma.fertilizerProduct.findFirst({
        where: { id: input.productId, organizationId },
        select: { id: true, status: true }
      })
    : null;

  if (input.productId && !product) {
    return notFound(
      "fertilizer_product_not_found",
      "Fertilizer product was not found in the active organization."
    );
  }

  if (
    product &&
    product.status !== FertilizerProductStatus.active &&
    input.allowInactiveProductId !== product.id
  ) {
    return conflict(
      "fertilizer_product_inactive",
      "Only active fertilizer products can be used in a new or retargeted application record."
    );
  }

  const worker = input.workerId
    ? await prisma.worker.findFirst({
        where: { id: input.workerId, organizationId },
        select: { id: true, fullName: true, farmSiteId: true, isActive: true }
      })
    : null;

  if (input.workerId && !worker) {
    return notFound("worker_not_found", "Worker was not found in the active organization.");
  }

  if (worker && !worker.isActive) {
    return conflict("worker_inactive", "Fertilizer application records require an active operator.");
  }

  if (worker?.farmSiteId && worker.farmSiteId !== plot.farmSiteId) {
    return conflict("fertilizer_context_conflict", "Worker is assigned to a different farm site.");
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
      "Evidence document must be in 'ready' status before it can support a fertilizer application record."
    );
  }

  const supersedesRecord = input.supersedesRecordId
    ? await prisma.fertilizerApplication.findFirst({
        where: {
          id: input.supersedesRecordId,
          organizationId
        },
        select: {
          id: true,
          plotId: true,
          cropCycleId: true
        }
      })
    : null;

  if (input.supersedesRecordId && !supersedesRecord) {
    return notFound(
      "fertilizer_application_not_found",
      "Superseded fertilizer application record was not found in the active organization."
    );
  }

  if (supersedesRecord?.id === input.currentApplicationId) {
    return conflict("fertilizer_supersession_conflict", "A record cannot supersede itself.");
  }

  if (supersedesRecord && supersedesRecord.plotId !== plot.id) {
    return conflict(
      "fertilizer_supersession_conflict",
      "Superseded fertilizer application must belong to the selected plot."
    );
  }

  if (
    supersedesRecord &&
    supersedesRecord.cropCycleId !== cropCycle.id
  ) {
    return conflict(
      "fertilizer_supersession_conflict",
      "Superseded fertilizer application must belong to the selected crop cycle."
    );
  }

  return {
    ok: true as const,
    farmSite: plot.farmSite,
    plot,
    cropCycle,
    product,
    worker,
    document,
    supersedesRecord
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

function auditApplicationPayload(
  tenant: { membershipId: string; role: OrganizationRole },
  item: ApplicationPayload
) {
  return {
    membershipId: tenant.membershipId,
    role: tenant.role,
    farmSiteId: item.farmSiteId,
    plotId: item.plotId,
    cropCycleId: item.cropCycleId,
    productId: item.productId,
    workerId: item.workerId,
    appliedAt: item.appliedAt.toISOString(),
    fertilizerName: item.fertilizerName,
    fertilizerType: item.fertilizerType,
    quantity: item.quantity,
    quantityUnit: item.quantityUnit,
    treatedArea: item.treatedArea,
    treatedAreaUnit: item.treatedAreaUnit,
    evidenceDocumentId: item.evidenceDocumentId,
    supersedesRecordId: item.supersedesRecordId
  };
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
