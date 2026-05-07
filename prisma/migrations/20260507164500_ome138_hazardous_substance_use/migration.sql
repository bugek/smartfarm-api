-- CreateEnum
CREATE TYPE "HazardousSubstanceProductStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "HazardousSubstanceStockEventType" AS ENUM ('received', 'used', 'adjusted', 'disposed');

-- CreateEnum
CREATE TYPE "HazardousSubstanceStorageCheckResult" AS ENUM ('pass', 'needs_action');

-- CreateTable
CREATE TABLE "HazardousSubstanceProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "activeIngredient" TEXT,
    "targetCrop" TEXT,
    "labelRateText" TEXT,
    "preHarvestIntervalDays" INTEGER,
    "status" "HazardousSubstanceProductStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HazardousSubstanceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardousSubstanceUseEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmSiteId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "cropCycleId" TEXT,
    "productId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "quantityUnit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "applicationMethod" TEXT,
    "targetPest" TEXT,
    "weatherNotes" TEXT,
    "evidenceDocumentId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HazardousSubstanceUseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardousSubstanceStockEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "eventType" "HazardousSubstanceStockEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "quantityUnit" TEXT NOT NULL,
    "workerId" TEXT,
    "useEventId" TEXT,
    "evidenceDocumentId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HazardousSubstanceStockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardousSubstanceStorageCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmSiteId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "storageLocation" TEXT NOT NULL,
    "checkedByWorkerId" TEXT,
    "approvedCropProductsSeparated" BOOLEAN NOT NULL,
    "lockedStorage" BOOLEAN NOT NULL,
    "labelsReadable" BOOLEAN NOT NULL,
    "sdsAvailable" BOOLEAN NOT NULL,
    "spillKitAvailable" BOOLEAN,
    "result" "HazardousSubstanceStorageCheckResult" NOT NULL,
    "issueNotes" TEXT,
    "evidenceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HazardousSubstanceStorageCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HazardousSubstanceProduct_organizationId_name_key" ON "HazardousSubstanceProduct"("organizationId", "name");

-- CreateIndex
CREATE INDEX "HazardousSubstanceProduct_organizationId_status_createdAt_idx" ON "HazardousSubstanceProduct"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceUseEvent_organizationId_appliedAt_idx" ON "HazardousSubstanceUseEvent"("organizationId", "appliedAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceUseEvent_organizationId_farmSiteId_applie_idx" ON "HazardousSubstanceUseEvent"("organizationId", "farmSiteId", "appliedAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceUseEvent_organizationId_plotId_appliedAt_idx" ON "HazardousSubstanceUseEvent"("organizationId", "plotId", "appliedAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceUseEvent_organizationId_productId_applied_idx" ON "HazardousSubstanceUseEvent"("organizationId", "productId", "appliedAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceUseEvent_organizationId_workerId_appliedA_idx" ON "HazardousSubstanceUseEvent"("organizationId", "workerId", "appliedAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceStockEvent_organizationId_productId_occur_idx" ON "HazardousSubstanceStockEvent"("organizationId", "productId", "occurredAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceStockEvent_organizationId_eventType_occur_idx" ON "HazardousSubstanceStockEvent"("organizationId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceStockEvent_organizationId_useEventId_idx" ON "HazardousSubstanceStockEvent"("organizationId", "useEventId");

-- CreateIndex
CREATE INDEX "HazardousSubstanceStorageCheck_organizationId_checkedAt_idx" ON "HazardousSubstanceStorageCheck"("organizationId", "checkedAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceStorageCheck_organizationId_result_checke_idx" ON "HazardousSubstanceStorageCheck"("organizationId", "result", "checkedAt");

-- CreateIndex
CREATE INDEX "HazardousSubstanceStorageCheck_organizationId_farmSiteId_ch_idx" ON "HazardousSubstanceStorageCheck"("organizationId", "farmSiteId", "checkedAt");

-- AddForeignKey
ALTER TABLE "HazardousSubstanceProduct" ADD CONSTRAINT "HazardousSubstanceProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceUseEvent" ADD CONSTRAINT "HazardousSubstanceUseEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceUseEvent" ADD CONSTRAINT "HazardousSubstanceUseEvent_farmSiteId_fkey" FOREIGN KEY ("farmSiteId") REFERENCES "FarmSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceUseEvent" ADD CONSTRAINT "HazardousSubstanceUseEvent_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceUseEvent" ADD CONSTRAINT "HazardousSubstanceUseEvent_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "CropCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceUseEvent" ADD CONSTRAINT "HazardousSubstanceUseEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "HazardousSubstanceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceUseEvent" ADD CONSTRAINT "HazardousSubstanceUseEvent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceUseEvent" ADD CONSTRAINT "HazardousSubstanceUseEvent_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStockEvent" ADD CONSTRAINT "HazardousSubstanceStockEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStockEvent" ADD CONSTRAINT "HazardousSubstanceStockEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "HazardousSubstanceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStockEvent" ADD CONSTRAINT "HazardousSubstanceStockEvent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStockEvent" ADD CONSTRAINT "HazardousSubstanceStockEvent_useEventId_fkey" FOREIGN KEY ("useEventId") REFERENCES "HazardousSubstanceUseEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStockEvent" ADD CONSTRAINT "HazardousSubstanceStockEvent_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStorageCheck" ADD CONSTRAINT "HazardousSubstanceStorageCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStorageCheck" ADD CONSTRAINT "HazardousSubstanceStorageCheck_farmSiteId_fkey" FOREIGN KEY ("farmSiteId") REFERENCES "FarmSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStorageCheck" ADD CONSTRAINT "HazardousSubstanceStorageCheck_checkedByWorkerId_fkey" FOREIGN KEY ("checkedByWorkerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardousSubstanceStorageCheck" ADD CONSTRAINT "HazardousSubstanceStorageCheck_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
