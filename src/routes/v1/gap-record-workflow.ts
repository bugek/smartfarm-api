import { EvidenceReviewStatus } from "@prisma/client";

export type GapRecordVersionReviewDecisionValue =
  | "approved"
  | "needs_more_evidence"
  | "blocking"
  | "comment";

export type GapRecordCurrentReviewState =
  | "unreviewed"
  | "approved"
  | "needs_more_evidence"
  | "blocking";

export type GapRecordCurrentReadinessStatus = "ready" | "partial" | "not_ready";

export function getLatestMeaningfulVersionReview<
  TReview extends {
    decision: GapRecordVersionReviewDecisionValue;
  }
>(reviews: TReview[]) {
  return [...reviews]
    .reverse()
    .find((review) => review.decision !== "comment") ?? null;
}

export function resolveGapRecordCurrentReviewState(
  reviews: Array<{
    decision: GapRecordVersionReviewDecisionValue;
  }>,
  activeEvidenceStatuses: EvidenceReviewStatus[]
): GapRecordCurrentReviewState {
  const latestReview = getLatestMeaningfulVersionReview(reviews);

  if (latestReview) {
    switch (latestReview.decision) {
      case "approved":
        return "approved";
      case "needs_more_evidence":
        return "needs_more_evidence";
      case "blocking":
        return "blocking";
      default:
        break;
    }
  }

  if (activeEvidenceStatuses.includes(EvidenceReviewStatus.needs_rework)) {
    return "needs_more_evidence";
  }

  return "unreviewed";
}

export function resolveGapRecordCurrentReadinessStatus(
  reviewState: GapRecordCurrentReviewState,
  activeEvidenceStatuses: EvidenceReviewStatus[]
): GapRecordCurrentReadinessStatus {
  if (reviewState === "blocking") {
    return "not_ready";
  }

  if (
    reviewState === "approved" &&
    activeEvidenceStatuses.every((status) => status === EvidenceReviewStatus.verified)
  ) {
    return "ready";
  }

  return "partial";
}

export function resolveFarmerCorrectionAction(reviewState: GapRecordCurrentReviewState) {
  if (reviewState === "blocking") {
    return "submit_record_correction" as const;
  }
  if (reviewState === "needs_more_evidence") {
    return "attach_evidence" as const;
  }
  return null;
}
