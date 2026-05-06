-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmSiteId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "roleTitle" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmSiteId" TEXT NOT NULL,
    "plotId" TEXT,
    "cropCycleId" TEXT,
    "workerId" TEXT,
    "activityType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Worker_organizationId_isActive_createdAt_idx" ON "Worker"("organizationId", "isActive", "createdAt");

-- CreateIndex
CREATE INDEX "Worker_farmSiteId_idx" ON "Worker"("farmSiteId");

-- CreateIndex
CREATE INDEX "OperationLog_organizationId_occurredAt_idx" ON "OperationLog"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "OperationLog_organizationId_farmSiteId_occurredAt_idx" ON "OperationLog"("organizationId", "farmSiteId", "occurredAt");

-- CreateIndex
CREATE INDEX "OperationLog_cropCycleId_occurredAt_idx" ON "OperationLog"("cropCycleId", "occurredAt");

-- CreateIndex
CREATE INDEX "OperationLog_workerId_occurredAt_idx" ON "OperationLog"("workerId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_farmSiteId_fkey" FOREIGN KEY ("farmSiteId") REFERENCES "FarmSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_farmSiteId_fkey" FOREIGN KEY ("farmSiteId") REFERENCES "FarmSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "CropCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
