import express, { Router } from "express";
import {
  DocumentStatus,
  EvidenceKind,
  EvidenceReviewDecision,
  EvidenceReviewStatus,
  OrganizationRole,
  Prisma
} from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { writeAuditEvent } from "../../lib/audit.js";
import {
  complianceControlPointSummarySelect,
  complianceSectionSummarySelect,
  resolveEvidenceComplianceBinding
} from "../../lib/compliance.js";
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

const evidenceSelect = {
  id: true,
  organizationId: true,
  gapRecordId: true,
  controlPointRef: true,
  complianceSectionVersionId: true,
  complianceControlPointVersionId: true,
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
  complianceSectionVersion: {
    select: complianceSectionSummarySelect
  },
  complianceControlPointVersion: {
    select: complianceControlPointSummarySelect
  }
} satisfies Prisma.EvidenceSelect;

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

      const complianceBinding = await resolveEvidenceComplianceBinding({
        organizationId: tenant.organizationId,
        gapRecordId: payload.gapRecordId,
        controlPointRef: payload.controlPointRef
      });

      if (complianceBinding.kind === "gap_record_not_found") {
        return res.status(404).json({
          error: { code: "gap_record_not_found", message: "GAP record not found in this organization." }
        });
      }
      if (complianceBinding.kind === "control_point_mismatch") {
        return res.status(409).json({
          error: {
            code: "control_point_mismatch",
            message:
              "controlPointRef does not match the GAP record's bound compliance control.",
            details: {
              expectedControlPointRef: complianceBinding.expectedControlPointRef,
              receivedControlPointRef: complianceBinding.receivedControlPointRef
            }
          }
        });
      }
      if (complianceBinding.kind === "compliance_control_binding_missing") {
        return res.status(409).json({
          error: {
            code: "compliance_control_binding_missing",
            message:
              "Evidence requires a GAP record bound to a known compliance control or a matching legacy controlPointRef.",
            details: {
              lookupControlPointRef: complianceBinding.lookupControlPointRef
            }
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
      const evidence = await prisma.evidence.create({
        data: {
          organizationId: tenant.organizationId,
          gapRecordId: complianceBinding.gapRecordId,
          controlPointRef: complianceBinding.controlPointRef,
          complianceSectionVersionId: complianceBinding.complianceSectionVersionId,
          complianceControlPointVersionId: complianceBinding.complianceControlPointVersionId,
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
        select: evidenceSelect
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
          complianceSectionVersionId: evidence.complianceSectionVersionId,
          complianceControlPointVersionId: evidence.complianceControlPointVersionId,
          documentId: evidence.documentId,
          hasGeo: evidence.geoLat != null && evidence.geoLng != null,
          capturedAt: evidence.capturedAt?.toISOString() ?? null
        }
      });

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
    const reviewStatus = typeof req.query.reviewStatus === "string" ? req.query.reviewStatus : undefined;
    if (reviewStatus && (Object.values(EvidenceReviewStatus) as string[]).includes(reviewStatus)) {
      where.reviewStatus = reviewStatus as EvidenceReviewStatus;
    }
    if (typeof req.query.gapRecordId === "string") {
      where.gapRecordId = req.query.gapRecordId;
    }
    if (typeof req.query.controlPointRef === "string") {
      where.controlPointRef = req.query.controlPointRef;
    }
    if (typeof req.query.complianceSectionVersionId === "string") {
      where.complianceSectionVersionId = req.query.complianceSectionVersionId;
    }
    if (typeof req.query.complianceControlPointVersionId === "string") {
      where.complianceControlPointVersionId = req.query.complianceControlPointVersionId;
    }

    const items = await prisma.evidence.findMany({
      where,
      orderBy: [{ reviewStatus: "asc" }, { submittedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: evidenceSelect
    });
    res.json({ items, organizationId: tenant.organizationId });
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
    });
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
          complianceSectionVersionId: true,
          complianceControlPointVersionId: true
        }
      });
      if (!evidence) {
        return res.status(404).json({
          error: { code: "evidence_not_found", message: "Evidence not found in this organization." }
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
        });
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
          complianceSectionVersionId: evidence.complianceSectionVersionId,
          complianceControlPointVersionId: evidence.complianceControlPointVersionId,
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
