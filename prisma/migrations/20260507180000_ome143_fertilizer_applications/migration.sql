-- CreateEnum
CREATE TYPE "FertilizerProductStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "FertilizerType" AS ENUM ('chemical', 'organic', 'biofertilizer', 'soil_amendment', 'other');

-- CreateTable
CREATE TABLE "FertilizerProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FertilizerType" NOT NULL DEFAULT 'other',
    "formulaLabelText" TEXT,
    "nutrientN" DOUBLE PRECISION,
    "nutrientP" DOUBLE PRECISION,
    "nutrientK" DOUBLE PRECISION,
    "sourceOrSupplier" TEXT,
    "status" "FertilizerProductStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FertilizerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FertilizerApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmSiteId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "cropCycleId" TEXT NOT NULL,
    "productId" TEXT,
    "workerId" TEXT,
    "evidenceDocumentId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "fertilizerName" TEXT NOT NULL,
    "fertilizerType" "FertilizerType" NOT NULL,
    "formulaLabelText" TEXT,
    "nutrientN" DOUBLE PRECISION,
    "nutrientP" DOUBLE PRECISION,
    "nutrientK" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION NOT NULL,
    "quantityUnit" TEXT NOT NULL,
    "applicationMethod" TEXT NOT NULL,
    "treatedArea" DOUBLE PRECISION NOT NULL,
    "treatedAreaUnit" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "reasonOrGrowthStage" TEXT NOT NULL,
    "sourceOrSupplier" TEXT,
    "lotNo" TEXT,
    "waterVolume" DOUBLE PRECISION,
    "waterVolumeUnit" TEXT,
    "equipmentName" TEXT,
    "weatherNotes" TEXT,
    "notes" TEXT,
    "supersedesRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FertilizerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FertilizerProduct_organizationId_name_key" ON "FertilizerProduct"("organizationId", "name");

-- CreateIndex
CREATE INDEX "FertilizerProduct_organizationId_status_createdAt_idx" ON "FertilizerProduct"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FertilizerProduct_organizationId_type_name_idx" ON "FertilizerProduct"("organizationId", "type", "name");

-- CreateIndex
CREATE INDEX "FertilizerApplication_organizationId_appliedAt_idx" ON "FertilizerApplication"("organizationId", "appliedAt");

-- CreateIndex
CREATE INDEX "FertilizerApplication_organizationId_farmSiteId_applied_idx" ON "FertilizerApplication"("organizationId", "farmSiteId", "appliedAt");

-- CreateIndex
CREATE INDEX "FertilizerApplication_organizationId_plotId_appliedAt_idx" ON "FertilizerApplication"("organizationId", "plotId", "appliedAt");

-- CreateIndex
CREATE INDEX "FertilizerApplication_organizationId_cropCycleId_appl_idx" ON "FertilizerApplication"("organizationId", "cropCycleId", "appliedAt");

-- CreateIndex
CREATE INDEX "FertilizerApplication_organizationId_productId_applied_idx" ON "FertilizerApplication"("organizationId", "productId", "appliedAt");

-- CreateIndex
CREATE INDEX "FertilizerApplication_organizationId_workerId_appliedA_idx" ON "FertilizerApplication"("organizationId", "workerId", "appliedAt");

-- CreateIndex
CREATE INDEX "FertilizerApplication_organizationId_supersedesRecordId_idx" ON "FertilizerApplication"("organizationId", "supersedesRecordId");

-- AddForeignKey
ALTER TABLE "FertilizerProduct" ADD CONSTRAINT "FertilizerProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_farmSiteId_fkey" FOREIGN KEY ("farmSiteId") REFERENCES "FarmSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "CropCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_productId_fkey" FOREIGN KEY ("productId") REFERENCES "FertilizerProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizerApplication" ADD CONSTRAINT "FertilizerApplication_supersedesRecordId_fkey" FOREIGN KEY ("supersedesRecordId") REFERENCES "FertilizerApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
