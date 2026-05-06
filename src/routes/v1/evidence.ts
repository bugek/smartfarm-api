import express, { Router } from "express";
import {
  DocumentStatus,
  EvidenceKind,
  EvidenceReviewDecision,
  EvidenceReviewStatus,
  GapRecordStatus,
  OrganizationRole,
  Prisma,
  ReviewThreadStatus
} from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";

export const evidenceRouter = Router();

evidenceRouter.use(express.json());
evidenceRouter.use(requireTenantContext);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const evidenceKindValues = Object.values(EvidenceKind) as [EvidenceKind, ...EvidenceKind[]];

const submitEvidenceSchema = z
  .object({
    gapRecordId: z.string().min(1),
    controlPointRef: z.string().trim().min(1).max(120).optional(),
    supersedesEvidenceIds: z.array(z.string().trim().min(1)).max(50).optional(),
    documentId: z.string().min(1).optional(),
    kind: z.enum(evidenceKindValues).optional(),
    fileName: z.string().trim().min(1).max(255).optional(),
    contentType: z.string().trim().min(1).max(120).optional(),
    fileSize: z.number().int().positive().optional(),
    storageKey: z.string().trim().min(1).max(512).optional(),
    noteText: z.string().trim().max(4000).optional(),
    capturedAt: z.coerce.date().optional(),
    geoLat: z.number().gte(-90).lte(90).optional(),
    geoLng: z.number().gte(-180).lte(180).optional()
  })
  .refine(
    (input) =>
      input.documentId != null ||
      (input.kind != null && input.fileName != null && input.storageKey != null),
    {
      message:
        "Provide documentId or the trio (kind, fileName, storageKey) for legacy direct uploads."
    }
  );

const reviewDecisionValues = Object.values(EvidenceReviewDecision) as [
  EvidenceReviewDecision,
  ...EvidenceReviewDecision[]
];

const reviewSchema = z.object({
  decision: z.enum(reviewDecisionValues),
  comment: z.string().trim().min(1).max(4000)
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const evidenceSelect: any = {
  id: true,
  organizationId: true,
  gapRecordId: true,
  gapRecordVersionId: true,
  controlPointRef: true,
  kind: true,
  storageKey: true,
  fileName: true,
  contentType: true,
  fileSize: true,
  capturedAt: true,
  geoLat: true,
  geoLng: true,
  noteText: true,
  documentId: true,
  supersededAt: true,
  supersededByEvidenceId: true,
  submittedByUserId: true,
  submittedAt: true,
  reviewStatus: true,
  lastReviewedByUserId: true,
  lastReviewedAt: true,
  createdAt: true,
  updatedAt: true,
  document: {
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
  supersedesEvidence: {
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true
    }
  }
};

function decisionToReviewStatus(
  decision: EvidenceReviewDecision,
  current: EvidenceReviewStatus
): EvidenceReviewStatus {
  switch (decision) {
    case EvidenceReviewDecision.verified:
      return EvidenceReviewStatus.verified;
    case EvidenceReviewDecision.needs_rework:
      return EvidenceReviewStatus.needs_rework;
    case EvidenceReviewDecision.comment:
      return current; // comments do not change status
    default:
      return current;
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/evidence -- worker submits photo-backed evidence
// ---------------------------------------------------------------------------

evidenceRouter.post(
  "/",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert,
    OrganizationRole.worker
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = submitEvidenceSchema.parse(req.body);
      const supersedesEvidenceIds = normalizeDistinctIds(payload.supersedesEvidenceIds);

      const gapRecord = await prisma.gapRecord.findFirst({
        where: { id: payload.gapRecordId, organizationId: tenant.organizationId },
        select: { id: true, currentVersionId: true }
      } as any);
      if (!gapRecord) {
        return res.status(404).json({
          error: { code: "gap_record_not_found", message: "GAP record not found in this organization." }
        });
      }
      if (!gapRecord.currentVersionId) {
        return res.status(409).json({
          error: {
            code: "gap_record_version_missing",
            message: "GAP record is missing a current version and cannot accept new evidence yet."
          }
        });
      }

      const supersededEvidence = await loadSupersededEvidenceCandidates(
        tenant.organizationId,
        gapRecord.id,
        supersedesEvidenceIds
      );
      const supersededEvidenceValidationError = validateSupersededEvidence(
        supersedesEvidenceIds,
        supersededEvidence
      );
      if (supersededEvidenceValidationError) {
        return res.status(supersededEvidenceValidationError.status).json({
          error: {
            code: supersededEvidenceValidationError.code,
            message: supersededEvidenceValidationError.message
          }
        });
      }

      let kind = payload.kind;
      let storageKey = payload.storageKey;
      let fileName = payload.fileName;
      let contentType = payload.contentType;
      let fileSize = payload.fileSize;

      if (payload.documentId) {
        const document = await prisma.document.findFirst({
          where: { id: payload.documentId, organizationId: tenant.organizationId },
          select: {
            id: true,
            status: true,
            kind: true,
            fileName: true,
            contentType: true,
            blobSize: true,
            storageKey: true
          }
        });
        if (!document) {
          return res.status(404).json({
            error: { code: "document_not_found", message: "Document not found in this organization." }
          });
        }
        if (document.status !== DocumentStatus.ready) {
          return res.status(409).json({
            error: {
              code: "document_not_ready",
              message: `Document must be in 'ready' status to attach as evidence. Current: ${document.status}.`
            }
          });
        }
        // Map document.kind -> evidence.kind narrowing (image/video/document).
        kind = kind ?? mapDocumentKindToEvidence(document.kind);
        storageKey = document.storageKey;
        fileName = fileName ?? document.fileName;
        contentType = contentType ?? document.contentType ?? undefined;
        fileSize = fileSize ?? document.blobSize ?? undefined;
      }

      if (!kind || !storageKey || !fileName) {
        return res.status(400).json({
          error: {
            code: "evidence_missing_blob",
            message: "Evidence requires kind, storageKey, and fileName when no documentId is supplied."
          }
        });
      }

      const now = new Date();
      const evidence = await prisma.$transaction(async (tx) => {
        const created = await tx.evidence.create({
          data: {
            organizationId: tenant.organizationId,
            gapRecordId: gapRecord.id,
            gapRecordVersionId: gapRecord.currentVersionId,
            controlPointRef: payload.controlPointRef ?? null,
            kind,
            storageKey,
            fileName,
            contentType: contentType ?? null,
            fileSize: fileSize ?? null,
            capturedAt: payload.capturedAt ?? null,
            geoLat: payload.geoLat ?? null,
            geoLng: payload.geoLng ?? null,
            noteText: payload.noteText ?? null,
            documentId: payload.documentId ?? null,
            submittedByUserId: tenant.userId,
            submittedAt: now,
            reviewStatus: EvidenceReviewStatus.pending_review
          },
          select: {
            id: true
          }
        } as any);

        if (supersedesEvidenceIds.length > 0) {
          await tx.evidence.updateMany({
            where: {
              id: {
                in: supersedesEvidenceIds
              },
              organizationId: tenant.organizationId,
              gapRecordId: gapRecord.id,
              supersededByEvidenceId: null
            },
            data: {
              supersededAt: now,
              supersededByEvidenceId: created.id
            }
          } as any);
        }

        await tx.gapRecord.update({
          where: {
            id: gapRecord.id
          },
          data: {
            status: GapRecordStatus.submitted,
            reviewThreadStatus: ReviewThreadStatus.awaiting_review
          }
        } as any);

        return tx.evidence.findUniqueOrThrow({
          where: {
            id: created.id
          },
          select: evidenceSelect
        } as any);
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "evidence",
        entityId: evidence.id,
        action: "evidence.submitted",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          gapRecordId: evidence.gapRecordId,
          controlPointRef: evidence.controlPointRef,
          documentId: evidence.documentId,
          supersedesEvidenceIds,
          hasGeo: evidence.geoLat != null && evidence.geoLng != null,
          capturedAt: evidence.capturedAt?.toISOString() ?? null
        }
      });

      for (const superseded of supersededEvidence) {
        await writeAuditEvent({
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          entityType: "evidence",
          entityId: superseded.id,
          action: "evidence.superseded_by_resubmission",
          payloadJson: {
            membershipId: tenant.membershipId,
            role: tenant.role,
            gapRecordId: superseded.gapRecordId,
            controlPointRef: superseded.controlPointRef,
            replacementEvidenceId: evidence.id,
            previousStatus: superseded.reviewStatus
          }
        });
      }

      res.status(201).json({ item: evidence });
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/evidence  &  GET /api/v1/evidence/:id
// ---------------------------------------------------------------------------

evidenceRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const where: Prisma.EvidenceWhereInput = { organizationId: tenant.organizationId };
    const includeSuperseded = req.query.includeSuperseded === "true";
    const reviewStatus = typeof req.query.reviewStatus === "string" ? req.query.reviewStatus : undefined;
    if (reviewStatus && (Object.values(EvidenceReviewStatus) as string[]).includes(reviewStatus)) {
      where.reviewStatus = reviewStatus as EvidenceReviewStatus;
    }
    if (!includeSuperseded) {
      where.supersededByEvidenceId = null;
    }
    if (typeof req.query.gapRecordId === "string") {
      where.gapRecordId = req.query.gapRecordId;
    }
    if (typeof req.query.controlPointRef === "string") {
      where.controlPointRef = req.query.controlPointRef;
    }

    const items = await prisma.evidence.findMany({
      where,
      orderBy: [{ reviewStatus: "asc" }, { submittedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: evidenceSelect
    } as any);
    res.json({
      items,
      organizationId: tenant.organizationId,
      filter: {
        reviewStatus: where.reviewStatus ?? null,
        gapRecordId: where.gapRecordId ?? null,
        controlPointRef: where.controlPointRef ?? null,
        includeSuperseded
      }
    });
  } catch (error) {
    next(error);
  }
});

evidenceRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const evidence = await prisma.evidence.findFirst({
      where: { id: req.params.id, organizationId: tenant.organizationId },
      select: {
        ...evidenceSelect,
        reviews: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            decision: true,
            comment: true,
            reviewerUserId: true,
            createdAt: true
          }
        }
      }
    } as any);
    if (!evidence) {
      return res.status(404).json({
        error: { code: "evidence_not_found", message: "Evidence not found in this organization." }
      });
    }
    res.json({ item: evidence });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/:id/reviews -- expert review (append-only log)
// ---------------------------------------------------------------------------

evidenceRouter.post(
  "/:id/reviews",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = reviewSchema.parse(req.body);

      const evidence = await prisma.evidence.findFirst({
        where: { id: String(req.params.id), organizationId: tenant.organizationId },
        select: {
          id: true,
          reviewStatus: true,
          gapRecordId: true,
          controlPointRef: true,
          supersededByEvidenceId: true
        }
      });
      if (!evidence) {
        return res.status(404).json({
          error: { code: "evidence_not_found", message: "Evidence not found in this organization." }
        });
      }
      if (evidence.supersededByEvidenceId) {
        return res.status(409).json({
          error: {
            code: "evidence_review_conflict",
            message: "Superseded evidence cannot be reviewed again. Review the active replacement evidence instead."
          }
        });
      }

      const nextStatus = decisionToReviewStatus(payload.decision, evidence.reviewStatus);
      const now = new Date();

      const result = await prisma.$transaction(async (tx) => {
        const review = await tx.evidenceReview.create({
          data: {
            evidenceId: evidence.id,
            organizationId: tenant.organizationId,
            reviewerUserId: tenant.userId,
            decision: payload.decision,
            comment: payload.comment
          },
          select: {
            id: true,
            decision: true,
            comment: true,
            reviewerUserId: true,
            createdAt: true
          }
        });
        const updated = await tx.evidence.update({
          where: { id: evidence.id },
          data: {
            reviewStatus: nextStatus,
            lastReviewedAt: now,
            lastReviewedByUserId: tenant.userId
          },
          select: evidenceSelect
        } as any);
        return { review, updated };
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "evidence",
        entityId: evidence.id,
        action: `evidence.review_${payload.decision}`,
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          reviewId: result.review.id,
          gapRecordId: evidence.gapRecordId,
          controlPointRef: evidence.controlPointRef,
          previousStatus: evidence.reviewStatus,
          nextStatus
        }
      });

      res.status(201).json({ item: result.updated, review: result.review });
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function mapDocumentKindToEvidence(kind: string): EvidenceKind {
  switch (kind) {
    case "image":
      return EvidenceKind.image;
    case "video":
      return EvidenceKind.video;
    default:
      return EvidenceKind.document;
  }
}

function normalizeDistinctIds(ids?: string[]) {
  return [...new Set((ids ?? []).map((value) => value.trim()).filter(Boolean))];
}

async function loadSupersededEvidenceCandidates(
  organizationId: string,
  gapRecordId: string,
  evidenceIds: string[]
) {
  if (evidenceIds.length === 0) {
    return [];
  }

  return prisma.evidence.findMany({
    where: {
      organizationId,
      gapRecordId,
      id: {
        in: evidenceIds
      }
    },
    select: {
      id: true,
      gapRecordId: true,
      controlPointRef: true,
      reviewStatus: true,
      supersededByEvidenceId: true
    }
  });
}

function validateSupersededEvidence(
  requestedIds: string[],
  candidates: Array<{
    id: string;
    gapRecordId: string;
    controlPointRef: string | null;
    reviewStatus: EvidenceReviewStatus;
    supersededByEvidenceId: string | null;
  }>
) {
  if (requestedIds.length === 0) {
    return null;
  }

  if (candidates.length !== requestedIds.length) {
    return {
      status: 400,
      code: "evidence_resubmission_target_invalid",
      message: "Replacement evidence can only supersede evidence from the same organization and GAP record."
    };
  }

  if (candidates.some((candidate) => candidate.supersededByEvidenceId != null)) {
    return {
      status: 409,
      code: "evidence_resubmission_target_conflict",
      message: "One or more selected evidence items were already superseded by a newer submission."
    };
  }

  if (candidates.some((candidate) => candidate.reviewStatus !== EvidenceReviewStatus.needs_rework)) {
    return {
      status: 409,
      code: "evidence_resubmission_target_status_invalid",
      message: "Only evidence in 'needs_rework' status can be superseded by a farmer correction submission."
    };
  }

  return null;
}
