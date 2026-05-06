-- OME-116: replace evidence controlPointRef stub with typed compliance control/section binding.

CREATE TYPE "ComplianceSchemeStatus" AS ENUM ('draft', 'active', 'retired');

CREATE TABLE "ComplianceScheme" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "authorityName" TEXT,
  "status" "ComplianceSchemeStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceScheme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplianceSchemeVersion" (
  "id" TEXT NOT NULL,
  "schemeId" TEXT NOT NULL,
  "versionLabel" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceSchemeVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplianceSectionVersion" (
  "id" TEXT NOT NULL,
  "schemeVersionId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceSectionVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplianceControlPointVersion" (
  "id" TEXT NOT NULL,
  "schemeVersionId" TEXT NOT NULL,
  "sectionVersionId" TEXT NOT NULL,
  "legacyChecklistId" TEXT,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "requirementText" TEXT,
  "guidanceText" TEXT,
  "sequence" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "requiresEvidence" BOOLEAN NOT NULL DEFAULT true,
  "requiresExpertReview" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceControlPointVersion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Evidence"
  ADD COLUMN "complianceSectionVersionId" TEXT,
  ADD COLUMN "complianceControlPointVersionId" TEXT;

CREATE UNIQUE INDEX "ComplianceScheme_code_key" ON "ComplianceScheme" ("code");
CREATE UNIQUE INDEX "ComplianceSchemeVersion_schemeId_versionLabel_key"
  ON "ComplianceSchemeVersion" ("schemeId", "versionLabel");
CREATE INDEX "ComplianceSchemeVersion_schemeId_isDefault_idx"
  ON "ComplianceSchemeVersion" ("schemeId", "isDefault");
CREATE UNIQUE INDEX "ComplianceSectionVersion_schemeVersionId_code_key"
  ON "ComplianceSectionVersion" ("schemeVersionId", "code");
CREATE INDEX "ComplianceSectionVersion_schemeVersionId_sequence_idx"
  ON "ComplianceSectionVersion" ("schemeVersionId", "sequence");
CREATE UNIQUE INDEX "ComplianceControlPointVersion_legacyChecklistId_key"
  ON "ComplianceControlPointVersion" ("legacyChecklistId");
CREATE UNIQUE INDEX "ComplianceControlPointVersion_schemeVersionId_code_key"
  ON "ComplianceControlPointVersion" ("schemeVersionId", "code");
CREATE INDEX "ComplianceControlPointVersion_sectionVersionId_sequence_idx"
  ON "ComplianceControlPointVersion" ("sectionVersionId", "sequence");

CREATE INDEX "Evidence_organizationId_complianceSectionVersionId_reviewStatus_idx"
  ON "Evidence" ("organizationId", "complianceSectionVersionId", "reviewStatus");
CREATE INDEX "Evidence_organizationId_complianceControlPointVersionId_reviewStatus_idx"
  ON "Evidence" ("organizationId", "complianceControlPointVersionId", "reviewStatus");

ALTER TABLE "ComplianceSchemeVersion"
  ADD CONSTRAINT "ComplianceSchemeVersion_schemeId_fkey"
  FOREIGN KEY ("schemeId") REFERENCES "ComplianceScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComplianceSectionVersion"
  ADD CONSTRAINT "ComplianceSectionVersion_schemeVersionId_fkey"
  FOREIGN KEY ("schemeVersionId") REFERENCES "ComplianceSchemeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComplianceControlPointVersion"
  ADD CONSTRAINT "ComplianceControlPointVersion_schemeVersionId_fkey"
  FOREIGN KEY ("schemeVersionId") REFERENCES "ComplianceSchemeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceControlPointVersion"
  ADD CONSTRAINT "ComplianceControlPointVersion_sectionVersionId_fkey"
  FOREIGN KEY ("sectionVersionId") REFERENCES "ComplianceSectionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceControlPointVersion"
  ADD CONSTRAINT "ComplianceControlPointVersion_legacyChecklistId_fkey"
  FOREIGN KEY ("legacyChecklistId") REFERENCES "GapChecklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_complianceSectionVersionId_fkey"
  FOREIGN KEY ("complianceSectionVersionId") REFERENCES "ComplianceSectionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_complianceControlPointVersionId_fkey"
  FOREIGN KEY ("complianceControlPointVersionId") REFERENCES "ComplianceControlPointVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ComplianceScheme" (
  "id",
  "code",
  "name",
  "authorityName",
  "status",
  "updatedAt"
) VALUES (
  'compliance_scheme_legacy_gap_catalog',
  'legacy_gap_catalog',
  'Legacy GAP Checklist Catalog',
  'SmartFarm',
  'active',
  CURRENT_TIMESTAMP
);

INSERT INTO "ComplianceSchemeVersion" (
  "id",
  "schemeId",
  "versionLabel",
  "publishedAt",
  "effectiveFrom",
  "isDefault",
  "updatedAt"
) VALUES (
  'compliance_scheme_version_legacy_gap_catalog_v1',
  'compliance_scheme_legacy_gap_catalog',
  'legacy-v1',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  true,
  CURRENT_TIMESTAMP
);

WITH checklist_sections AS (
  SELECT DISTINCT
    COALESCE(NULLIF(regexp_replace(regexp_replace("code", '^.*-', ''), '\.[^.]+$', ''), ''), "code") AS section_code
  FROM "GapChecklist"
),
ordered_sections AS (
  SELECT
    section_code,
    DENSE_RANK() OVER (
      ORDER BY
        COALESCE(NULLIF((regexp_match(section_code, '([0-9]+)'))[1], ''), '2147483647')::INTEGER,
        section_code
    ) AS sequence
  FROM checklist_sections
)
INSERT INTO "ComplianceSectionVersion" (
  "id",
  "schemeVersionId",
  "code",
  "title",
  "sequence",
  "updatedAt"
)
SELECT
  'compliance_section_' || md5(section_code),
  'compliance_scheme_version_legacy_gap_catalog_v1',
  section_code,
  'Section ' || section_code,
  sequence,
  CURRENT_TIMESTAMP
FROM ordered_sections;

WITH checklist_controls AS (
  SELECT
    gc."id" AS checklist_id,
    gc."code",
    gc."title",
    gc."description",
    COALESCE(NULLIF(regexp_replace(regexp_replace(gc."code", '^.*-', ''), '\.[^.]+$', ''), ''), gc."code") AS section_code,
    COALESCE(NULLIF((regexp_match(gc."code", '([0-9]+)(?!.*[0-9])'))[1], ''), '0')::INTEGER AS control_sequence
  FROM "GapChecklist" gc
)
INSERT INTO "ComplianceControlPointVersion" (
  "id",
  "schemeVersionId",
  "sectionVersionId",
  "legacyChecklistId",
  "code",
  "title",
  "requirementText",
  "sequence",
  "updatedAt"
)
SELECT
  'compliance_control_' || md5(checklist_id),
  'compliance_scheme_version_legacy_gap_catalog_v1',
  csv."id",
  checklist_id,
  code,
  title,
  "description",
  control_sequence,
  CURRENT_TIMESTAMP
FROM checklist_controls cc
JOIN "ComplianceSectionVersion" csv
  ON csv."schemeVersionId" = 'compliance_scheme_version_legacy_gap_catalog_v1'
 AND csv."code" = cc.section_code;

WITH evidence_binding AS (
  SELECT
    e."id" AS evidence_id,
    ccpv."id" AS control_id,
    ccpv."sectionVersionId" AS section_id,
    ccpv."code" AS control_code
  FROM "Evidence" e
  LEFT JOIN "GapRecord" gr
    ON gr."id" = e."gapRecordId"
  LEFT JOIN "ComplianceControlPointVersion" ccpv
    ON ccpv."legacyChecklistId" = gr."checklistId"
    OR (gr."checklistId" IS NULL AND e."controlPointRef" IS NOT NULL AND ccpv."code" = e."controlPointRef")
)
UPDATE "Evidence" e
SET
  "complianceControlPointVersionId" = eb.control_id,
  "complianceSectionVersionId" = eb.section_id,
  "controlPointRef" = COALESCE(eb.control_code, e."controlPointRef")
FROM evidence_binding eb
WHERE e."id" = eb.evidence_id;
