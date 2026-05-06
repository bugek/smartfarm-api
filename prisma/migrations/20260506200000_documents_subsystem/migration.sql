-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('image', 'video', 'pdf', 'spreadsheet', 'other');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('pending_upload', 'uploaded', 'processing', 'ready', 'failed', 'quarantined');

-- CreateEnum
CREATE TYPE "DocumentJobKind" AS ENUM ('validate_blob', 'extract_text');

-- CreateEnum
CREATE TYPE "DocumentJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'retrying', 'dead_letter');

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN "documentId" TEXT;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'pending_upload',
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "declaredSize" INTEGER,
    "storageProvider" TEXT NOT NULL DEFAULT 'local_disk',
    "storageKey" TEXT NOT NULL,
    "blobSize" INTEGER,
    "blobSha256" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "DocumentJobKind" NOT NULL,
    "status" "DocumentJobStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_organizationId_status_idx" ON "Document"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Document_organizationId_createdAt_idx" ON "Document"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentJob_status_scheduledAt_idx" ON "DocumentJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "DocumentJob_documentId_kind_idx" ON "DocumentJob"("documentId", "kind");

-- CreateIndex
CREATE INDEX "DocumentJob_organizationId_status_idx" ON "DocumentJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Evidence_documentId_idx" ON "Evidence"("documentId");

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentJob" ADD CONSTRAINT "DocumentJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
