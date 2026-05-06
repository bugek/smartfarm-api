import {
  EvidenceReviewDecision,
  EvidenceReviewStatus,
  Prisma,
  ReviewThreadStatus
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  resolveFarmerCorrectionAction,
  resolveGapRecordCurrentReadinessStatus,
  resolveGapRecordCurrentReviewState
} from "./gap-record-workflow.js";

const gapRecordReviewThreadSelect: any = {
  id: true,
  organizationId: true,
  title: true,
  reviewThreadStatus: true,
  currentVersionId: true,
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
      gapRecordVersionId: true,
      fileName: true,
      kind: true,
      submittedAt: true,
      createdAt: true,
      reviewStatus: true,
      supersededAt: true,
      supersededByEvidenceId: true,
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
  versions: {
    orderBy: [{ versionNumber: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      versionNumber: true,
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
  comments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      authorUserId: true,
      body: true,
      createdAt: true
    }
  }
};

type GapRecordReviewThreadRecord = any;

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
  } as any);

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
  for (const version of record.versions) {
    for (const review of version.reviews) {
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
  const currentVersionId = record.currentVersion?.id ?? null;
  const currentVersionEvidences = record.evidences.filter(
    (evidence: any) => evidence.gapRecordVersionId === currentVersionId
  );
  const activeEvidences = currentVersionEvidences.filter(isWorkflowActiveEvidence);
  const currentReviewState = resolveGapRecordCurrentReviewState(
    record.currentVersion?.reviews ?? [],
    activeEvidences.map((evidence: any) => evidence.reviewStatus)
  );
  const currentReadinessStatus = resolveGapRecordCurrentReadinessStatus(
    currentReviewState,
    activeEvidences.map((evidence: any) => evidence.reviewStatus)
  );
  const comments = [
    ...record.comments.map((comment: any) => {
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
    ...record.evidences.flatMap((evidence: any) =>
      evidence.reviews.map((review: any) => {
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
          evidenceKind: evidence.kind,
          evidenceSupersededAt: evidence.supersededAt,
          evidenceSupersededByEvidenceId: evidence.supersededByEvidenceId
        };
      })
    ),
    ...record.versions.flatMap((version: any) =>
      version.reviews.map((review: any) => {
        const identity = identities.get(review.reviewerUserId);
        return {
          id: review.id,
          reviewId: record.id,
          source: "record_review" as const,
          body: review.comment,
          createdAt: review.createdAt,
          authorUserId: review.reviewerUserId,
          authorName: identity?.name ?? review.reviewerUserId,
          authorRole: identity?.role ?? null,
          decision: review.decision,
          gapRecordVersionId: version.id,
          gapRecordVersionNumber: version.versionNumber
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

  const evidenceCounts = activeEvidences.reduce(
    (acc: any, evidence: any) => {
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
    status: resolveThreadStatus(
      record.reviewThreadStatus,
      activeEvidences.map((evidence: any) => evidence.reviewStatus)
    ),
    submittedAt:
      activeEvidences.find((evidence: any) => evidence.submittedAt)?.submittedAt ??
      record.evidences.find((evidence: any) => evidence.submittedAt)?.submittedAt ??
      record.recordedAt ??
      record.createdAt,
    updatedAt: latestActivityAt,
    currentReviewState,
    currentReadinessStatus,
    recommendedCorrectionAction: resolveFarmerCorrectionAction(currentReviewState),
    currentVersion: record.currentVersion
      ? {
          id: record.currentVersion.id,
          versionNumber: record.currentVersion.versionNumber,
          isCurrent: record.currentVersion.isCurrent,
          titleSnapshot: record.currentVersion.titleSnapshot,
          notesSnapshot: record.currentVersion.notesSnapshot,
          recordedAt: record.currentVersion.recordedAt,
          createdAt: record.currentVersion.createdAt,
          latestReview:
            record.currentVersion.reviews.length > 0
              ? record.currentVersion.reviews[record.currentVersion.reviews.length - 1]
              : null
        }
      : null,
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
  if (evidenceStatuses.includes(EvidenceReviewStatus.pending_review)) {
    return ReviewThreadStatus.awaiting_review;
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

export function isWorkflowActiveEvidence<
  TEvidence extends {
    supersededByEvidenceId: string | null;
  }
>(evidence: TEvidence) {
  return evidence.supersededByEvidenceId == null;
}

export { resolveThreadStatus };
