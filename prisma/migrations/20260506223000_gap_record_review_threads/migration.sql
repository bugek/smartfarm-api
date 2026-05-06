-- OME-95: per-gap-record review threads.
-- Adds an explicit review thread status on GapRecord; thread comments reuse
-- AdvisoryComment and thread history merges those comments with EvidenceReview.

CREATE TYPE "ReviewThreadStatus" AS ENUM (
  'awaiting_review',
  'changes_requested',
  'approved',
  'rejected'
);

ALTER TABLE "GapRecord"
  ADD COLUMN "reviewThreadStatus" "ReviewThreadStatus" NOT NULL DEFAULT 'awaiting_review';
