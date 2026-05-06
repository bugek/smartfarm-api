CREATE TYPE "GapRecordVersionReviewDecision" AS ENUM (
  'approved',
  'needs_more_evidence',
  'blocking',
  'comment'
);

CREATE TABLE "GapRecordVersion" (
  "id" TEXT NOT NULL,
  "gapRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "supersededAt" TIMESTAMP(3),
  "supersededByVersionId" TEXT,
  "createdByUserId" TEXT,
  "titleSnapshot" TEXT NOT NULL,
  "notesSnapshot" TEXT,
  "recordedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GapRecordVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GapRecordVersionReview" (
  "id" TEXT NOT NULL,
  "gapRecordVersionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "decision" "GapRecordVersionReviewDecision" NOT NULL,
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GapRecordVersionReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GapRecord"
  ADD COLUMN "currentVersionId" TEXT;

ALTER TABLE "Evidence"
  ADD COLUMN "gapRecordVersionId" TEXT;

WITH inserted_versions AS (
  INSERT INTO "GapRecordVersion" (
    "id",
    "gapRecordId",
    "organizationId",
    "versionNumber",
    "isCurrent",
    "titleSnapshot",
    "notesSnapshot",
    "recordedAt",
    "createdAt"
  )
  SELECT
    'gvr_' || md5("id" || clock_timestamp()::text),
    "id",
    "organizationId",
    1,
    true,
    "title",
    "notes",
    "recordedAt",
    "createdAt"
  FROM "GapRecord"
  RETURNING "id", "gapRecordId"
)
UPDATE "GapRecord" AS g
SET "currentVersionId" = inserted_versions."id"
FROM inserted_versions
WHERE inserted_versions."gapRecordId" = g."id";

UPDATE "Evidence" AS e
SET "gapRecordVersionId" = g."currentVersionId"
FROM "GapRecord" AS g
WHERE g."id" = e."gapRecordId";

ALTER TABLE "GapRecord"
  ADD CONSTRAINT "GapRecord_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "GapRecordVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_gapRecordVersionId_fkey"
  FOREIGN KEY ("gapRecordVersionId") REFERENCES "GapRecordVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GapRecordVersion"
  ADD CONSTRAINT "GapRecordVersion_gapRecordId_fkey"
  FOREIGN KEY ("gapRecordId") REFERENCES "GapRecord"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapRecordVersion"
  ADD CONSTRAINT "GapRecordVersion_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapRecordVersion"
  ADD CONSTRAINT "GapRecordVersion_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GapRecordVersion"
  ADD CONSTRAINT "GapRecordVersion_supersededByVersionId_fkey"
  FOREIGN KEY ("supersededByVersionId") REFERENCES "GapRecordVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GapRecordVersionReview"
  ADD CONSTRAINT "GapRecordVersionReview_gapRecordVersionId_fkey"
  FOREIGN KEY ("gapRecordVersionId") REFERENCES "GapRecordVersion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapRecordVersionReview"
  ADD CONSTRAINT "GapRecordVersionReview_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapRecordVersionReview"
  ADD CONSTRAINT "GapRecordVersionReview_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "GapRecordVersion_gapRecordId_versionNumber_key"
  ON "GapRecordVersion"("gapRecordId", "versionNumber");

CREATE INDEX "GapRecord_organizationId_currentVersionId_idx"
  ON "GapRecord"("organizationId", "currentVersionId");

CREATE INDEX "Evidence_gapRecordVersionId_idx"
  ON "Evidence"("gapRecordVersionId");

CREATE INDEX "GapRecordVersion_organizationId_gapRecordId_isCurrent_idx"
  ON "GapRecordVersion"("organizationId", "gapRecordId", "isCurrent");

CREATE INDEX "GapRecordVersion_organizationId_supersededByVersionId_idx"
  ON "GapRecordVersion"("organizationId", "supersededByVersionId");

CREATE INDEX "GapRecordVersionReview_gapRecordVersionId_createdAt_idx"
  ON "GapRecordVersionReview"("gapRecordVersionId", "createdAt");

CREATE INDEX "GapRecordVersionReview_organizationId_decision_createdAt_idx"
  ON "GapRecordVersionReview"("organizationId", "decision", "createdAt");
