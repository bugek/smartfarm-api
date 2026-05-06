-- OME-18: upload-to-review pipeline + reviewer queue.
-- Extends Evidence with control-point binding, review state, geolocation, and
-- a worker submit path; adds an append-only EvidenceReview log.

-- New enums --------------------------------------------------------------
CREATE TYPE "EvidenceReviewStatus" AS ENUM ('pending_review', 'verified', 'needs_rework');
CREATE TYPE "EvidenceReviewDecision" AS ENUM ('verified', 'needs_rework', 'comment');

-- Evidence extensions -----------------------------------------------------
ALTER TABLE "Evidence"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "controlPointRef" TEXT,
  ADD COLUMN "geoLat" DOUBLE PRECISION,
  ADD COLUMN "geoLng" DOUBLE PRECISION,
  ADD COLUMN "noteText" TEXT,
  ADD COLUMN "submittedByUserId" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewStatus" "EvidenceReviewStatus" NOT NULL DEFAULT 'pending_review',
  ADD COLUMN "lastReviewedByUserId" TEXT,
  ADD COLUMN "lastReviewedAt" TIMESTAMP(3);

-- Backfill organizationId from the parent GAP record so existing rows pass
-- the upcoming NOT NULL + FK constraints.
UPDATE "Evidence" e
SET "organizationId" = g."organizationId"
FROM "GapRecord" g
WHERE g."id" = e."gapRecordId" AND e."organizationId" IS NULL;

ALTER TABLE "Evidence"
  ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;

CREATE INDEX "Evidence_organizationId_reviewStatus_createdAt_idx"
  ON "Evidence" ("organizationId", "reviewStatus", "createdAt");
CREATE INDEX "Evidence_organizationId_controlPointRef_reviewStatus_idx"
  ON "Evidence" ("organizationId", "controlPointRef", "reviewStatus");

-- EvidenceReview append-only log -----------------------------------------
CREATE TABLE "EvidenceReview" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "decision" "EvidenceReviewDecision" NOT NULL,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EvidenceReview"
  ADD CONSTRAINT "EvidenceReview_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE;
ALTER TABLE "EvidenceReview"
  ADD CONSTRAINT "EvidenceReview_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;

CREATE INDEX "EvidenceReview_evidenceId_createdAt_idx"
  ON "EvidenceReview" ("evidenceId", "createdAt");
CREATE INDEX "EvidenceReview_organizationId_decision_createdAt_idx"
  ON "EvidenceReview" ("organizationId", "decision", "createdAt");

-- Enforce append-only semantics at the DB layer for in-place mutations.
-- Cascade deletes from parent Evidence / Organization are still allowed so
-- tenant teardown stays possible; application code must never issue an
-- explicit DELETE on individual review rows.
CREATE OR REPLACE FUNCTION "evidence_review_block_updates"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'EvidenceReview rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "evidence_review_no_update"
  BEFORE UPDATE ON "EvidenceReview"
  FOR EACH ROW EXECUTE FUNCTION "evidence_review_block_updates"();
