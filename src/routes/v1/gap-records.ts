import express, { Router } from "express";
import { GapRecordStatus, OrganizationRole, Prisma, ReviewThreadStatus } from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import {
  resolveFarmerCorrectionAction,
  resolveGapRecordCurrentReadinessStatus,
  resolveGapRecordCurrentReviewState
} from "./gap-record-workflow.js";
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

const submitGapRecordCorrectionSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    recordedAt: z.coerce.date().nullable().optional()
  })
  .refine(
    (input) =>
      input.title !== undefined || input.notes !== undefined || input.recordedAt !== undefined,
    {
      message: "Provide at least one corrected field."
    }
  );

const gapRecordSelect: any = {
  id: true,
  organizationId: true,
  cropCycleId: true,
  checklistId: true,
  currentVersionId: true,
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
  currentVersion: {
    select: {
      id: true,
      versionNumber: true,
      isCurrent: true,
      titleSnapshot: true,
      notesSnapshot: true,
      recordedAt: true,
      createdAt: true,
      reviews: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewerUserId: true,
          createdAt: true
        }
      }
    }
  },
  evidences: {
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      gapRecordVersionId: true,
      reviewStatus: true,
      supersededByEvidenceId: true,
      fileName: true,
      kind: true,
      submittedAt: true,
      createdAt: true,
      reviews: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewerUserId: true,
          createdAt: true
        }
      }
    }
  }
};

type GapRecordPayload = any;

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
    } as any);

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

gapRecordsRouter.get("/:id/findings", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const gapRecordId = String(req.params.id);
    const item: GapRecordPayload | null = await prisma.gapRecord.findFirst({
      where: {
        id: gapRecordId,
        organizationId: tenant.organizationId
      },
      select: gapRecordSelect
    } as any);

    if (!item) {
      return res.status(404).json({
        error: {
          code: "gap_record_not_found",
          message: "GAP record not found in this organization."
        }
      });
    }

    res.json({
      item: serializeGapRecordFindings(item)
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

gapRecordsRouter.post(
  "/:id/corrections",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert,
    OrganizationRole.worker
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const gapRecordId = String(req.params.id);
      const payload = submitGapRecordCorrectionSchema.parse(req.body);

      const existing: GapRecordPayload | null = await prisma.gapRecord.findFirst({
        where: {
          id: gapRecordId,
          organizationId: tenant.organizationId
        },
      select: gapRecordSelect
    } as any);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "gap_record_not_found",
            message: "GAP record not found in this organization."
          }
        });
      }

      if (!existing.currentVersion) {
        return res.status(409).json({
          error: {
            code: "gap_record_current_version_missing",
            message: "GAP record is missing its current version and cannot be corrected yet."
          }
        });
      }

      const now = new Date();
      const nextTitle = payload.title ?? existing.currentVersion.titleSnapshot;
      const nextNotes =
        payload.notes === undefined ? existing.currentVersion.notesSnapshot : payload.notes ?? null;
      const nextRecordedAt =
        payload.recordedAt === undefined ? existing.currentVersion.recordedAt : payload.recordedAt ?? null;
      const nextVersionNumber = existing.currentVersion.versionNumber + 1;

      const item = await prisma.$transaction(async (tx): Promise<GapRecordPayload> => {
        const createdVersion = await (tx as any).gapRecordVersion.create({
          data: {
            gapRecordId: existing.id,
            organizationId: tenant.organizationId,
            versionNumber: nextVersionNumber,
            isCurrent: true,
            createdByUserId: tenant.userId,
            titleSnapshot: nextTitle,
            notesSnapshot: nextNotes,
            recordedAt: nextRecordedAt
          },
          select: {
            id: true
          }
        });

        await (tx as any).gapRecordVersion.update({
          where: {
            id: existing.currentVersion.id
          },
          data: {
            isCurrent: false,
            supersededAt: now,
            supersededByVersionId: createdVersion.id
          }
        });

        await tx.gapRecord.update({
          where: {
            id: existing.id
          },
          data: {
            currentVersionId: createdVersion.id,
            title: nextTitle,
            notes: nextNotes,
            recordedAt: nextRecordedAt,
            status: GapRecordStatus.submitted,
            reviewThreadStatus: ReviewThreadStatus.awaiting_review
          }
        } as any);

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "gap_record",
            entityId: existing.id,
            action: "gap_record.correction_submitted",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              previousVersionId: existing.currentVersion.id,
              nextVersionId: createdVersion.id,
              nextVersionNumber,
              cropCycleId: existing.cropCycle?.id ?? null,
              farmSiteId: existing.cropCycle?.farmSite.id ?? null,
              plotId: existing.cropCycle?.plot?.id ?? null,
              controlPointRef: existing.checklist?.code ?? null
            }
          }
        });

        return tx.gapRecord.findUniqueOrThrow({
          where: {
            id: existing.id
          },
          select: gapRecordSelect
        } as any);
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "gap_record_version",
        entityId: item.currentVersionId ?? item.id,
        action: "gap_record_version.created_from_correction",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          gapRecordId: item.id,
          versionNumber: item.currentVersion?.versionNumber ?? nextVersionNumber,
          controlPointRef: item.checklist?.code ?? null
        }
      });

      res.status(201).json({
        item: serializeGapRecord(item)
      });
    } catch (error) {
      next(error);
    }
  }
);

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
      } as any);

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
        } as any);

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
  const currentVersionId = record.currentVersion?.id ?? null;
  const currentVersionEvidence = record.evidences.filter(
    (evidence: any) => evidence.gapRecordVersionId === currentVersionId
  );
  const activeCurrentVersionEvidence = currentVersionEvidence.filter(isWorkflowActiveEvidence);
  const activeEvidenceStatuses = activeCurrentVersionEvidence.map((evidence: any) => evidence.reviewStatus);
  const currentReviewState = resolveGapRecordCurrentReviewState(
    record.currentVersion?.reviews ?? [],
    activeEvidenceStatuses
  );
  const currentReadinessStatus = resolveGapRecordCurrentReadinessStatus(
    currentReviewState,
    activeEvidenceStatuses
  );
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
    currentReviewState,
    currentReadinessStatus,
    recommendedCorrectionAction: resolveFarmerCorrectionAction(currentReviewState),
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
    currentVersion: record.currentVersion
      ? {
          id: record.currentVersion.id,
          versionNumber: record.currentVersion.versionNumber,
          isCurrent: record.currentVersion.isCurrent,
          titleSnapshot: record.currentVersion.titleSnapshot,
          notesSnapshot: record.currentVersion.notesSnapshot,
          recordedAt: record.currentVersion.recordedAt,
          createdAt: record.currentVersion.createdAt
        }
      : null,
    evidenceCount: record._count.evidences,
    advisoryCommentCount: record._count.comments
  };
}

function serializeGapRecordFindings(record: GapRecordPayload) {
  const base = serializeGapRecord(record);
  const currentVersionId = record.currentVersion?.id ?? null;
  const currentVersionEvidence = record.evidences.filter(
    (evidence: any) => evidence.gapRecordVersionId === currentVersionId
  );
  const activeCurrentVersionEvidence = currentVersionEvidence.filter(isWorkflowActiveEvidence);
  const latestRecordReview = [...(record.currentVersion?.reviews ?? [])].reverse()[0] ?? null;

  return {
    ...base,
    latestRecordReview: latestRecordReview
      ? {
          id: latestRecordReview.id,
          decision: latestRecordReview.decision,
          comment: latestRecordReview.comment,
          reviewerUserId: latestRecordReview.reviewerUserId,
          createdAt: latestRecordReview.createdAt
        }
      : null,
    findings: [
      ...(record.currentVersion?.reviews ?? [])
        .filter((review: any) => review.decision !== "approved" && review.decision !== "comment")
        .map((review: any) => ({
          id: review.id,
          source: "record_review" as const,
          decision: review.decision,
          comment: review.comment,
          reviewerUserId: review.reviewerUserId,
          createdAt: review.createdAt,
          recommendedAction:
            review.decision === "blocking" ? "submit_record_correction" : "attach_evidence"
        })),
      ...activeCurrentVersionEvidence
        .flatMap((evidence: any) =>
          evidence.reviews
            .filter((review: any) => review.decision === "needs_rework")
            .map((review: any) => ({
              id: review.id,
              source: "evidence_review" as const,
              evidenceId: evidence.id,
              evidenceFileName: evidence.fileName,
              evidenceKind: evidence.kind,
              decision: "needs_more_evidence" as const,
              comment: review.comment,
              reviewerUserId: review.reviewerUserId,
              createdAt: review.createdAt,
              recommendedAction: "attach_evidence" as const
            }))
        )
    ]
  };
}
