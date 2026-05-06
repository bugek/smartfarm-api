ALTER TABLE "Evidence"
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "supersededByEvidenceId" TEXT;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_supersededByEvidenceId_fkey"
  FOREIGN KEY ("supersededByEvidenceId") REFERENCES "Evidence"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Evidence_organizationId_supersededByEvidenceId_reviewStatus_idx"
  ON "Evidence"("organizationId", "supersededByEvidenceId", "reviewStatus");
