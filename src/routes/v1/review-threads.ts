import { EvidenceReviewDecision, EvidenceReviewStatus, Prisma, ReviewThreadStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

const gapRecordReviewThreadSelect = {
  id: true,
  organizationId: true,
  title: true,
  reviewThreadStatus: true,
  recordedAt: true,
  createdAt: true,
  updatedAt: true,
  checklist: {
    select: {
      code: true,
      title: true
    }
  },
  evidences: {
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      fileName: true,
      kind: true,
      submittedAt: true,
      createdAt: true,
      reviewStatus: true,
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
  },
  comments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      authorUserId: true,
      body: true,
      createdAt: true
    }
  }
} satisfies Prisma.GapRecordSelect;

type GapRecordReviewThreadRecord = Prisma.GapRecordGetPayload<{
  select: typeof gapRecordReviewThreadSelect;
}>;

type IdentityMap = Map<
  string,
  {
    name: string;
    role: string | null;
  }
>;

export async function getReviewThread(
  organizationId: string,
  gapRecordId: string
): Promise<ReturnType<typeof serializeReviewThread> | null> {
  const record = await prisma.gapRecord.findFirst({
    where: { id: gapRecordId, organizationId },
    select: gapRecordReviewThreadSelect
  });

  if (!record) {
    return null;
  }

  const identities = await loadAuthorIdentities(
    organizationId,
    collectAuthorUserIds(record)
  );

  return serializeReviewThread(record, identities);
}

function collectAuthorUserIds(record: GapRecordReviewThreadRecord) {
  const ids = new Set<string>();

  for (const comment of record.comments) {
    ids.add(comment.authorUserId);
  }
  for (const evidence of record.evidences) {
    for (const review of evidence.reviews) {
      ids.add(review.reviewerUserId);
    }
  }

  return [...ids];
}

async function loadAuthorIdentities(organizationId: string, userIds: string[]): Promise<IdentityMap> {
  if (userIds.length === 0) {
    return new Map();
  }

  const memberships = await prisma.membership.findMany({
    where: {
      organizationId,
      userId: { in: userIds }
    },
    select: {
      userId: true,
      role: true,
      user: {
        select: {
          displayName: true,
          email: true
        }
      }
    }
  });

  return new Map(
    memberships.map((membership) => [
      membership.userId,
      {
        name: membership.user.displayName || membership.user.email,
        role: membership.role
      }
    ])
  );
}

function serializeReviewThread(record: GapRecordReviewThreadRecord, identities: IdentityMap) {
  const comments = [
    ...record.comments.map((comment) => {
      const identity = identities.get(comment.authorUserId);
      return {
        id: comment.id,
        reviewId: record.id,
        source: "thread_comment" as const,
        body: comment.body,
        createdAt: comment.createdAt,
        authorUserId: comment.authorUserId,
        authorName: identity?.name ?? comment.authorUserId,
        authorRole: identity?.role ?? null
      };
    }),
    ...record.evidences.flatMap((evidence) =>
      evidence.reviews.map((review) => {
        const identity = identities.get(review.reviewerUserId);
        return {
          id: review.id,
          reviewId: record.id,
          source: "evidence_review" as const,
          body: review.comment,
          createdAt: review.createdAt,
          authorUserId: review.reviewerUserId,
          authorName: identity?.name ?? review.reviewerUserId,
          authorRole: identity?.role ?? null,
          decision: review.decision,
          evidenceId: evidence.id,
          evidenceFileName: evidence.fileName,
          evidenceKind: evidence.kind
        };
      })
    )
  ].sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
  });

  const latestActivityAt = [record.updatedAt, ...comments.map((comment) => comment.createdAt)].reduce(
    (latest, candidate) => (new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest)
  );

  const evidenceCounts = record.evidences.reduce(
    (acc, evidence) => {
      acc.total += 1;
      if (evidence.reviewStatus === EvidenceReviewStatus.pending_review) acc.pendingReview += 1;
      if (evidence.reviewStatus === EvidenceReviewStatus.verified) acc.verified += 1;
      if (evidence.reviewStatus === EvidenceReviewStatus.needs_rework) acc.needsRework += 1;
      return acc;
    },
    { total: 0, pendingReview: 0, verified: 0, needsRework: 0 }
  );

  return {
    id: record.id,
    gapRecordId: record.id,
    organizationId: record.organizationId,
    title: record.title,
    controlPointRef: record.checklist?.code ?? null,
    controlPointTitle: record.checklist?.title ?? null,
    status: resolveThreadStatus(record.reviewThreadStatus, record.evidences.map((evidence) => evidence.reviewStatus)),
    submittedAt:
      record.evidences.find((evidence) => evidence.submittedAt)?.submittedAt ??
      record.recordedAt ??
      record.createdAt,
    updatedAt: latestActivityAt,
    evidenceSummary: evidenceCounts,
    comments
  };
}

function resolveThreadStatus(
  persistedStatus: ReviewThreadStatus,
  evidenceStatuses: EvidenceReviewStatus[]
): ReviewThreadStatus {
  if (persistedStatus === ReviewThreadStatus.rejected) {
    return ReviewThreadStatus.rejected;
  }
  if (evidenceStatuses.includes(EvidenceReviewStatus.needs_rework)) {
    return ReviewThreadStatus.changes_requested;
  }
  if (
    evidenceStatuses.length > 0 &&
    evidenceStatuses.every((status) => status === EvidenceReviewStatus.verified)
  ) {
    return ReviewThreadStatus.approved;
  }
  if (
    persistedStatus === ReviewThreadStatus.approved ||
    persistedStatus === ReviewThreadStatus.changes_requested
  ) {
    return persistedStatus;
  }
  return ReviewThreadStatus.awaiting_review;
}

export const reviewThreadStatusValues = Object.values(ReviewThreadStatus) as [
  ReviewThreadStatus,
  ...ReviewThreadStatus[]
];

export const evidenceReviewDecisionValues = Object.values(EvidenceReviewDecision) as [
  EvidenceReviewDecision,
  ...EvidenceReviewDecision[]
];
