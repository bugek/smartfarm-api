import express, { Router } from "express";
import { EvidenceReviewStatus, OrganizationRole, Prisma } from "@prisma/client";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

export const reviewQueueRouter = Router();

reviewQueueRouter.use(express.json());
reviewQueueRouter.use(requireTenantContext);
reviewQueueRouter.use(
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ])
);

const queueEvidenceSelect = {
  id: true,
  gapRecordId: true,
  controlPointRef: true,
  reviewStatus: true,
  supersededByEvidenceId: true,
  submittedAt: true,
  submittedByUserId: true,
  fileName: true,
  kind: true,
  noteText: true,
  capturedAt: true,
  documentId: true,
  createdAt: true,
  gapRecord: {
    select: {
      id: true,
      title: true,
      status: true,
      cropCycle: {
        select: {
          id: true,
          farmSiteId: true,
          farmSite: { select: { id: true, name: true, code: true } }
        }
      }
    }
  }
} satisfies Prisma.EvidenceSelect;

reviewQueueRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);

    const requestedStatus =
      typeof req.query.status === "string" ? req.query.status : EvidenceReviewStatus.pending_review;
    const status = (Object.values(EvidenceReviewStatus) as string[]).includes(requestedStatus)
      ? (requestedStatus as EvidenceReviewStatus)
      : EvidenceReviewStatus.pending_review;

    const where: Prisma.EvidenceWhereInput = {
      organizationId: tenant.organizationId,
      reviewStatus: status,
      supersededByEvidenceId: null
    };

    if (typeof req.query.farmSiteId === "string") {
      where.gapRecord = {
        cropCycle: { farmSiteId: req.query.farmSiteId }
      };
    }
    if (typeof req.query.controlPointRef === "string") {
      where.controlPointRef = req.query.controlPointRef;
    }

    // Order: farm site name, then controlPointRef (acts as section sort key),
    // then oldest submission first so backlog drains FIFO.
    const items = await prisma.evidence.findMany({
      where,
      orderBy: [
        { gapRecord: { cropCycle: { farmSite: { name: "asc" } } } },
        { controlPointRef: "asc" },
        { submittedAt: "asc" },
        { createdAt: "asc" }
      ],
      take: 200,
      select: queueEvidenceSelect
    });

    const counts = await prisma.evidence.groupBy({
      by: ["reviewStatus"],
      where: { organizationId: tenant.organizationId, supersededByEvidenceId: null },
      _count: { reviewStatus: true }
    });

    res.json({
      organizationId: tenant.organizationId,
      filter: { status, farmSiteId: req.query.farmSiteId ?? null, controlPointRef: req.query.controlPointRef ?? null },
      counts: counts.reduce<Record<string, number>>((acc, row) => {
        acc[row.reviewStatus] = row._count.reviewStatus;
        return acc;
      }, {}),
      items
    });
  } catch (error) {
    next(error);
  }
});
