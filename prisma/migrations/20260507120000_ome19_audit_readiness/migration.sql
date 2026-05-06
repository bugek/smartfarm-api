-- OME-19: audit readiness dashboard, corrective actions, and packet export.

CREATE TYPE "CorrectiveActionStatus" AS ENUM (
  'open_unassigned',
  'assigned',
  'submitted_for_review',
  'verified',
  'closed'
);

CREATE TABLE "CorrectiveAction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "gapRecordId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "controlPointRef" TEXT,
  "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'open_unassigned',
  "ownerUserId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "assignedAt" TIMESTAMP(3),
  "submittedForReviewAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectiveAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorrectiveActionEvidence" (
  "id" TEXT NOT NULL,
  "correctiveActionId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectiveActionEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CorrectiveAction_organizationId_status_dueAt_idx"
  ON "CorrectiveAction" ("organizationId", "status", "dueAt");
CREATE INDEX "CorrectiveAction_organizationId_ownerUserId_status_idx"
  ON "CorrectiveAction" ("organizationId", "ownerUserId", "status");
CREATE INDEX "CorrectiveAction_gapRecordId_status_idx"
  ON "CorrectiveAction" ("gapRecordId", "status");

CREATE UNIQUE INDEX "CorrectiveActionEvidence_correctiveActionId_evidenceId_key"
  ON "CorrectiveActionEvidence" ("correctiveActionId", "evidenceId");
CREATE INDEX "CorrectiveActionEvidence_organizationId_correctiveActionId_idx"
  ON "CorrectiveActionEvidence" ("organizationId", "correctiveActionId");
CREATE INDEX "CorrectiveActionEvidence_organizationId_evidenceId_idx"
  ON "CorrectiveActionEvidence" ("organizationId", "evidenceId");

ALTER TABLE "CorrectiveAction"
  ADD CONSTRAINT "CorrectiveAction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction"
  ADD CONSTRAINT "CorrectiveAction_gapRecordId_fkey"
  FOREIGN KEY ("gapRecordId") REFERENCES "GapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CorrectiveActionEvidence"
  ADD CONSTRAINT "CorrectiveActionEvidence_correctiveActionId_fkey"
  FOREIGN KEY ("correctiveActionId") REFERENCES "CorrectiveAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectiveActionEvidence"
  ADD CONSTRAINT "CorrectiveActionEvidence_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectiveActionEvidence"
  ADD CONSTRAINT "CorrectiveActionEvidence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
