-- CreateEnum
CREATE TYPE "TraceLotStatus" AS ENUM ('open', 'on_hold', 'released', 'shipped', 'recalled', 'closed');

-- CreateEnum
CREATE TYPE "TraceLotLineageRelationshipType" AS ENUM ('split', 'merge', 'repack', 'relabel');

-- CreateEnum
CREATE TYPE "TraceLotGapRecordLinkType" AS ENUM ('evidence_source', 'release_gate', 'supporting_record');

-- CreateEnum
CREATE TYPE "TraceDispatchDestinationType" AS ENUM ('customer', 'warehouse', 'processor', 'internal');

-- CreateEnum
CREATE TYPE "TraceDispatchStatus" AS ENUM ('draft', 'dispatched', 'acknowledged', 'recalled', 'cancelled');

-- CreateEnum
CREATE TYPE "TraceabilityExerciseStatus" AS ENUM ('draft', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "RetentionSubjectType" AS ENUM ('gap_record', 'evidence', 'document', 'trace_lot', 'trace_dispatch', 'traceability_exercise', 'audit_packet', 'derived_artifact', 'job_artifact');

-- CreateEnum
CREATE TYPE "RetentionExecutionDecision" AS ENUM ('archived', 'purged', 'skipped_hold', 'skipped_not_due');

-- CreateEnum
CREATE TYPE "RetentionExecutionActorType" AS ENUM ('system', 'user');

-- CreateTable
CREATE TABLE "TraceLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmSiteId" TEXT NOT NULL,
    "cropCycleId" TEXT,
    "code" TEXT NOT NULL,
    "commodityName" TEXT NOT NULL,
    "varietyName" TEXT,
    "packHouseName" TEXT,
    "harvestedAt" TIMESTAMP(3) NOT NULL,
    "packedAt" TIMESTAMP(3),
    "status" "TraceLotStatus" NOT NULL DEFAULT 'open',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraceLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceLotLineage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentLotId" TEXT NOT NULL,
    "childLotId" TEXT NOT NULL,
    "relationshipType" "TraceLotLineageRelationshipType" NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceLotLineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceLotGapRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "gapRecordId" TEXT NOT NULL,
    "linkType" "TraceLotGapRecordLinkType" NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceLotGapRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceDispatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationType" "TraceDispatchDestinationType" NOT NULL,
    "shippedAt" TIMESTAMP(3) NOT NULL,
    "status" "TraceDispatchStatus" NOT NULL DEFAULT 'draft',
    "externalRefJson" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraceDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceDispatchLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceDispatchLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceabilityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lotId" TEXT,
    "dispatchId" TEXT,
    "exerciseId" TEXT,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceabilityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceabilityExercise" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetLotId" TEXT NOT NULL,
    "status" "TraceabilityExerciseStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "initiatedByUserId" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraceabilityExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "subjectType" "RetentionSubjectType" NOT NULL,
    "retainDays" INTEGER NOT NULL,
    "archiveAfterDays" INTEGER,
    "purgeAfterDays" INTEGER,
    "legalBasis" TEXT,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" "RetentionSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" "RetentionSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "decision" "RetentionExecutionDecision" NOT NULL,
    "actorType" "RetentionExecutionActorType" NOT NULL DEFAULT 'user',
    "actorUserId" TEXT,
    "evidenceJson" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TraceLot_organizationId_code_key" ON "TraceLot"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TraceLot_organizationId_harvestedAt_idx" ON "TraceLot"("organizationId", "harvestedAt");

-- CreateIndex
CREATE INDEX "TraceLot_organizationId_cropCycleId_status_idx" ON "TraceLot"("organizationId", "cropCycleId", "status");

-- CreateIndex
CREATE INDEX "TraceLot_farmSiteId_idx" ON "TraceLot"("farmSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "TraceLotLineage_parentLotId_childLotId_relationshipType_key" ON "TraceLotLineage"("parentLotId", "childLotId", "relationshipType");

-- CreateIndex
CREATE INDEX "TraceLotLineage_organizationId_parentLotId_idx" ON "TraceLotLineage"("organizationId", "parentLotId");

-- CreateIndex
CREATE INDEX "TraceLotLineage_organizationId_childLotId_idx" ON "TraceLotLineage"("organizationId", "childLotId");

-- CreateIndex
CREATE UNIQUE INDEX "TraceLotGapRecord_lotId_gapRecordId_linkType_key" ON "TraceLotGapRecord"("lotId", "gapRecordId", "linkType");

-- CreateIndex
CREATE INDEX "TraceLotGapRecord_organizationId_lotId_idx" ON "TraceLotGapRecord"("organizationId", "lotId");

-- CreateIndex
CREATE INDEX "TraceLotGapRecord_organizationId_gapRecordId_idx" ON "TraceLotGapRecord"("organizationId", "gapRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "TraceDispatch_organizationId_code_key" ON "TraceDispatch"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TraceDispatch_organizationId_shippedAt_idx" ON "TraceDispatch"("organizationId", "shippedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TraceDispatchLot_dispatchId_lotId_key" ON "TraceDispatchLot"("dispatchId", "lotId");

-- CreateIndex
CREATE INDEX "TraceDispatchLot_organizationId_dispatchId_idx" ON "TraceDispatchLot"("organizationId", "dispatchId");

-- CreateIndex
CREATE INDEX "TraceDispatchLot_organizationId_lotId_idx" ON "TraceDispatchLot"("organizationId", "lotId");

-- CreateIndex
CREATE INDEX "TraceabilityEvent_organizationId_occurredAt_idx" ON "TraceabilityEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "TraceabilityEvent_organizationId_lotId_occurredAt_idx" ON "TraceabilityEvent"("organizationId", "lotId", "occurredAt");

-- CreateIndex
CREATE INDEX "TraceabilityEvent_organizationId_dispatchId_occurredAt_idx" ON "TraceabilityEvent"("organizationId", "dispatchId", "occurredAt");

-- CreateIndex
CREATE INDEX "TraceabilityEvent_organizationId_exerciseId_occurredAt_idx" ON "TraceabilityEvent"("organizationId", "exerciseId", "occurredAt");

-- CreateIndex
CREATE INDEX "TraceabilityExercise_organizationId_targetLotId_status_idx" ON "TraceabilityExercise"("organizationId", "targetLotId", "status");

-- CreateIndex
CREATE INDEX "TraceabilityExercise_organizationId_startedAt_idx" ON "TraceabilityExercise"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "RetentionPolicy_organizationId_subjectType_activeFrom_idx" ON "RetentionPolicy"("organizationId", "subjectType", "activeFrom");

-- CreateIndex
CREATE INDEX "RetentionPolicy_subjectType_isDefault_idx" ON "RetentionPolicy"("subjectType", "isDefault");

-- CreateIndex
CREATE INDEX "RetentionHold_organizationId_subjectType_subjectId_idx" ON "RetentionHold"("organizationId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "RetentionHold_organizationId_releasedAt_idx" ON "RetentionHold"("organizationId", "releasedAt");

-- CreateIndex
CREATE INDEX "RetentionExecution_organizationId_subjectType_subjectId_idx" ON "RetentionExecution"("organizationId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "RetentionExecution_organizationId_executedAt_idx" ON "RetentionExecution"("organizationId", "executedAt");

-- CreateIndex
CREATE INDEX "RetentionExecution_policyId_idx" ON "RetentionExecution"("policyId");

-- AddForeignKey
ALTER TABLE "TraceLot" ADD CONSTRAINT "TraceLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLot" ADD CONSTRAINT "TraceLot_farmSiteId_fkey" FOREIGN KEY ("farmSiteId") REFERENCES "FarmSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLot" ADD CONSTRAINT "TraceLot_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "CropCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLotLineage" ADD CONSTRAINT "TraceLotLineage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLotLineage" ADD CONSTRAINT "TraceLotLineage_parentLotId_fkey" FOREIGN KEY ("parentLotId") REFERENCES "TraceLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLotLineage" ADD CONSTRAINT "TraceLotLineage_childLotId_fkey" FOREIGN KEY ("childLotId") REFERENCES "TraceLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLotGapRecord" ADD CONSTRAINT "TraceLotGapRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLotGapRecord" ADD CONSTRAINT "TraceLotGapRecord_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "TraceLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLotGapRecord" ADD CONSTRAINT "TraceLotGapRecord_gapRecordId_fkey" FOREIGN KEY ("gapRecordId") REFERENCES "GapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceDispatch" ADD CONSTRAINT "TraceDispatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceDispatchLot" ADD CONSTRAINT "TraceDispatchLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceDispatchLot" ADD CONSTRAINT "TraceDispatchLot_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "TraceDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceDispatchLot" ADD CONSTRAINT "TraceDispatchLot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "TraceLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityEvent" ADD CONSTRAINT "TraceabilityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityEvent" ADD CONSTRAINT "TraceabilityEvent_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "TraceLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityEvent" ADD CONSTRAINT "TraceabilityEvent_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "TraceDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityEvent" ADD CONSTRAINT "TraceabilityEvent_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "TraceabilityExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityExercise" ADD CONSTRAINT "TraceabilityExercise_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityExercise" ADD CONSTRAINT "TraceabilityExercise_targetLotId_fkey" FOREIGN KEY ("targetLotId") REFERENCES "TraceLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionHold" ADD CONSTRAINT "RetentionHold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionExecution" ADD CONSTRAINT "RetentionExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionExecution" ADD CONSTRAINT "RetentionExecution_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "RetentionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
