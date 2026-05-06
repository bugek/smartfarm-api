import express, { Router } from "express";
import {
  GapRecordStatus,
  OrganizationRole,
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
import { getReviewThread, reviewThreadStatusValues } from "./review-threads.js";

const reviewQuerySchema = z.object({
  gapRecordId: z.string().trim().min(1)
});

const createReviewCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000)
});

const versionReviewDecisionValues = [
  "approved",
  "needs_more_evidence",
  "blocking",
  "comment"
] as const;

const updateReviewSchema = z.object({
  status: z.enum(reviewThreadStatusValues),
  comment: z.string().trim().min(1).max(4000).optional()
});

const createVersionReviewSchema = z.object({
  decision: z.enum(versionReviewDecisionValues),
  comment: z.string().trim().min(1).max(4000)
});

export const reviewsRouter = Router();

reviewsRouter.use(express.json());
reviewsRouter.use(requireTenantContext);

reviewsRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const { gapRecordId } = reviewQuerySchema.parse(req.query);
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

reviewsRouter.post(
  "/:id/comments",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert,
    OrganizationRole.worker
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const reviewId = String(req.params.id);
      const payload = createReviewCommentSchema.parse(req.body);

      const gapRecord = await prisma.gapRecord.findFirst({
        where: { id: reviewId, organizationId: tenant.organizationId },
        select: { id: true, checklist: { select: { code: true } } }
      });

      if (!gapRecord) {
        return res.status(404).json({
          error: {
            code: "review_not_found",
            message: "Review thread not found in this organization."
          }
        });
      }

      const comment = await prisma.advisoryComment.create({
        data: {
          gapRecordId: gapRecord.id,
          authorUserId: tenant.userId,
          body: payload.body
        },
        select: {
          id: true,
          gapRecordId: true,
          authorUserId: true,
          body: true,
          createdAt: true
        }
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "review_thread",
        entityId: gapRecord.id,
        action: "review_thread.comment_added",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          controlPointRef: gapRecord.checklist?.code ?? null,
          commentId: comment.id
        }
      });

      res.status(201).json({ item: comment });
    } catch (error) {
      next(error);
    }
  }
);

reviewsRouter.patch(
  "/:id",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const reviewId = String(req.params.id);
      const payload = updateReviewSchema.parse(req.body);

      const existing = await prisma.gapRecord.findFirst({
        where: { id: reviewId, organizationId: tenant.organizationId },
        select: {
          id: true,
          reviewThreadStatus: true,
          checklist: { select: { code: true } }
        }
      });

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "review_not_found",
            message: "Review thread not found in this organization."
          }
        });
      }

      await prisma.$transaction(async (tx) => {
        if (existing.reviewThreadStatus !== payload.status) {
          await tx.gapRecord.update({
            where: { id: existing.id },
            data: { reviewThreadStatus: payload.status }
          });
        }

        if (payload.comment) {
          await tx.advisoryComment.create({
            data: {
              gapRecordId: existing.id,
              authorUserId: tenant.userId,
              body: payload.comment
            }
          });
        }

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "review_thread",
            entityId: existing.id,
            action: "review_thread.status_updated",
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              controlPointRef: existing.checklist?.code ?? null,
              previousStatus: existing.reviewThreadStatus,
              nextStatus: payload.status,
              commentIncluded: Boolean(payload.comment)
            }
          }
        });
      });

      const item = await getReviewThread(tenant.organizationId, existing.id);
      res.json({ item });
    } catch (error) {
      next(error);
    }
  }
);

reviewsRouter.post(
  "/:id/decisions",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const reviewId = String(req.params.id);
      const payload = createVersionReviewSchema.parse(req.body);

      const existing: any = await prisma.gapRecord.findFirst({
        where: { id: reviewId, organizationId: tenant.organizationId },
        select: {
          id: true,
          currentVersionId: true,
          checklist: { select: { code: true } }
        }
      } as any);

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "review_not_found",
            message: "Review thread not found in this organization."
          }
        });
      }

      if (!existing.currentVersionId) {
        return res.status(409).json({
          error: {
            code: "gap_record_current_version_missing",
            message: "Review thread cannot accept a record decision without a current GAP record version."
          }
        });
      }

      const gapRecordUpdate =
        payload.decision === "approved"
          ? {
              status: GapRecordStatus.approved,
              reviewThreadStatus: ReviewThreadStatus.approved
            }
          : payload.decision === "comment"
            ? {}
            : {
                status: GapRecordStatus.needs_action,
                reviewThreadStatus: ReviewThreadStatus.changes_requested
              };

      const review = await prisma.$transaction(async (tx) => {
        const created = await (tx as any).gapRecordVersionReview.create({
          data: {
            gapRecordVersionId: existing.currentVersionId!,
            organizationId: tenant.organizationId,
            reviewerUserId: tenant.userId,
            decision: payload.decision,
            comment: payload.comment
          },
          select: {
            id: true,
            gapRecordVersionId: true,
            decision: true,
            comment: true,
            reviewerUserId: true,
            createdAt: true
          }
        });

        if (Object.keys(gapRecordUpdate).length > 0) {
          await tx.gapRecord.update({
            where: {
              id: existing.id
            },
            data: gapRecordUpdate
          } as any);
        }

        await tx.auditEvent.create({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            entityType: "gap_record_version",
            entityId: existing.currentVersionId!,
            action: `gap_record_version.review_${payload.decision}`,
            payloadJson: {
              membershipId: tenant.membershipId,
              role: tenant.role,
              gapRecordId: existing.id,
              controlPointRef: existing.checklist?.code ?? null,
              reviewId: created.id
            }
          }
        });

        return created;
      });

      const item = await getReviewThread(tenant.organizationId, existing.id);
      res.status(201).json({ item, review });
    } catch (error) {
      next(error);
    }
  }
);
