import express, { Router } from "express";
import { GapRecordStatus, OrganizationRole, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";
import { getReviewThread, isWorkflowActiveEvidence, resolveThreadStatus } from "./review-threads.js";

const gapRecordStatusValues = Object.values(GapRecordStatus) as [
  GapRecordStatus,
  ...GapRecordStatus[]
];

const listGapRecordsQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional(),
  plotId: z.string().trim().min(1).optional(),
  cropCycleId: z.string().trim().min(1).optional(),
  status: z.enum(gapRecordStatusValues).optional()
});

const updateGapRecordSchema = z.object({
  status: z.enum(gapRecordStatusValues)
});

const gapRecordSelect = {
  id: true,
  organizationId: true,
  cropCycleId: true,
  checklistId: true,
  title: true,
  notes: true,
  status: true,
  reviewThreadStatus: true,
  recordedAt: true,
  createdAt: true,
  updatedAt: true,
  checklist: {
    select: {
      id: true,
      code: true,
      title: true,
      description: true
    }
  },
  cropCycle: {
    select: {
      id: true,
      cropName: true,
      startedAt: true,
      endedAt: true,
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
  },
  _count: {
    select: {
      evidences: true,
      comments: true
    }
  },
  evidences: {
    select: {
      reviewStatus: true,
      supersededByEvidenceId: true
    }
  }
} satisfies Prisma.GapRecordSelect;

type GapRecordPayload = Prisma.GapRecordGetPayload<{
  select: typeof gapRecordSelect;
}>;

export const gapRecordsRouter = Router();

gapRecordsRouter.use(express.json());
gapRecordsRouter.use(requireTenantContext);

gapRecordsRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listGapRecordsQuerySchema.parse(req.query);

    const where: Prisma.GapRecordWhereInput = {
      organizationId: tenant.organizationId
    };

    if (filters.cropCycleId) {
      where.cropCycleId = filters.cropCycleId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.farmSiteId || filters.plotId) {
      where.cropCycle = {
        ...(filters.farmSiteId ? { farmSiteId: filters.farmSiteId } : {}),
        ...(filters.plotId ? { plotId: filters.plotId } : {})
      };
    }

    const items = await prisma.gapRecord.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: gapRecordSelect
    });

    res.json({
      items: items.map(serializeGapRecord),
      organizationId: tenant.organizationId,
      filters: {
        farmSiteId: filters.farmSiteId ?? null,
        plotId: filters.plotId ?? null,
        cropCycleId: filters.cropCycleId ?? null,
        status: filters.status ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

gapRecordsRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const gapRecordId = String(req.params.id);
    const item: GapRecordPayload | null = await prisma.gapRecord.findFirst({
      where: {
        id: gapRecordId,
        organizationId: tenant.organizationId
      },
      select: gapRecordSelect
    });

    if (!item) {
      return res.status(404).json({
        error: {
          code: "gap_record_not_found",
          message: "GAP record not found in this organization."
        }
      });
    }

    res.json({
      item: serializeGapRecord(item)
    });
  } catch (error) {
    next(error);
  }
});

gapRecordsRouter.get("/:id/reviews", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const gapRecordId = String(req.params.id);
    const item = await getReviewThread(tenant.organizationId, gapRecordId);

    if (!item) {
      return res.status(404).json({
        error: {
          code: "gap_record_not_found",
          message: "GAP record not found in this organization."
        }
      });
    }

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

gapRecordsRouter.patch(
  "/:id",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const gapRecordId = String(req.params.id);
      const payload = updateGapRecordSchema.parse(req.body);

      const existing: GapRecordPayload | null = await prisma.gapRecord.findFirst({
        where: {
          id: gapRecordId,
          organizationId: tenant.organizationId
        },
        select: gapRecordSelect
      });

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "gap_record_not_found",
            message: "GAP record not found in this organization."
          }
        });
      }

      if (existing.status === payload.status) {
        return res.json({
          item: serializeGapRecord(existing)
        });
      }

      const item = await prisma.$transaction(async (tx): Promise<GapRecordPayload> => {
        const updated: GapRecordPayload = await tx.gapRecord.update({
          where: {
            id: existing.id
          },
          data: {
            status: payload.status
          },
          select: gapRecordSelect
        });

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "gap_record",
            entityId: existing.id,
            action: "gap_record.status_updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousStatus: existing.status,
              nextStatus: payload.status,
              cropCycleId: updated.cropCycle?.id ?? null,
              farmSiteId: updated.cropCycle?.farmSite.id ?? null,
              plotId: updated.cropCycle?.plot?.id ?? null,
              controlPointRef: updated.checklist?.code ?? null
            }
          }
        });

        return updated;
      });

      res.json({
        item: serializeGapRecord(item)
      });
    } catch (error) {
      next(error);
    }
  }
);

function serializeGapRecord(record: GapRecordPayload) {
  const activeEvidenceStatuses = record.evidences
    .filter(isWorkflowActiveEvidence)
    .map((evidence) => evidence.reviewStatus);
  const controlPointCatalog = record.checklist
    ? {
        id: record.checklist.id,
        code: record.checklist.code,
        title: record.checklist.title,
        description: record.checklist.description
      }
    : null;

  return {
    id: record.id,
    organizationId: record.organizationId,
    cropCycleId: record.cropCycleId,
    checklistId: record.checklistId,
    title: record.title,
    notes: record.notes,
    status: record.status,
    reviewThreadStatus: resolveThreadStatus(record.reviewThreadStatus, activeEvidenceStatuses),
    recordedAt: record.recordedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    controlPointRef: controlPointCatalog?.code ?? null,
    controlPointCatalog,
    cropCycle: record.cropCycle
      ? {
          id: record.cropCycle.id,
          cropName: record.cropCycle.cropName,
          startedAt: record.cropCycle.startedAt,
          endedAt: record.cropCycle.endedAt,
          farmSite: record.cropCycle.farmSite,
          plot: record.cropCycle.plot
        }
      : null,
    evidenceCount: record._count.evidences,
    advisoryCommentCount: record._count.comments
  };
}
