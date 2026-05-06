import { OrganizationRole, Prisma } from "@prisma/client";
import { DocumentJobStatus, DocumentKind, DocumentStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { runDueJobs } from "../../lib/jobs.js";
import {
  buildStorageKey,
  presignDownload,
  presignUpload,
  readBlobStream,
  verifyToken,
  writeBlob
} from "../../lib/storage.js";

export const documentsRouter = Router();

const MAX_DECLARED_BYTES = 100 * 1024 * 1024; // 100 MB cap for v1.
const MAX_UPLOAD_BYTES = MAX_DECLARED_BYTES + 1024;

const documentKindValues = Object.values(DocumentKind) as [DocumentKind, ...DocumentKind[]];

const createDocumentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  kind: z.enum(documentKindValues),
  contentType: z.string().trim().min(1).max(120).optional(),
  declaredSize: z.number().int().positive().max(MAX_DECLARED_BYTES).optional(),
  metadata: z.record(z.any()).optional()
});

// ----- Blob endpoints (token-authenticated; no tenant headers required) -----
// Mounted before requireTenantContext so the presigned URL flow stays self-contained.
documentsRouter.put("/_blob/:token", express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }), async (req, res, next) => {
  try {
    const payload = verifyToken(req.params.token);
    if (payload.o !== "put") {
      return res.status(403).json({
        error: { code: "wrong_token_op", message: "Token is not valid for upload." }
      });
    }
    const document = await prisma.document.findUnique({ where: { id: payload.d } });
    if (!document || document.storageKey !== payload.k) {
      return res.status(404).json({
        error: { code: "document_not_found", message: "Document does not exist." }
      });
    }
    if (document.status !== DocumentStatus.pending_upload) {
      return res.status(409).json({
        error: {
          code: "document_not_uploadable",
          message: `Document is in status ${document.status}; uploads are not allowed.`
        }
      });
    }
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      return res.status(400).json({
        error: { code: "empty_body", message: "Upload body must be non-empty binary content." }
      });
    }
    if (document.declaredSize != null && body.byteLength !== document.declaredSize) {
      return res.status(400).json({
        error: {
          code: "declared_size_mismatch",
          message: `Body size ${body.byteLength} does not match declaredSize ${document.declaredSize}.`
        }
      });
    }
    const stat = await writeBlob(document.storageKey, body);
    await prisma.document.update({
      where: { id: document.id },
      data: {
        status: DocumentStatus.uploaded,
        uploadedAt: new Date(),
        blobSize: stat.size
      }
    });
    return res.json({
      ok: true,
      documentId: document.id,
      blobSize: stat.size
    });
  } catch (error) {
    if (error instanceof Error && error.message === "blob_already_exists") {
      return res.status(409).json({
        error: {
          code: "blob_immutable",
          message: "Blob already written for this document; documents are immutable."
        }
      });
    }
    if (
      error instanceof Error &&
      ["invalid_token", "invalid_token_signature", "token_expired"].includes(error.message)
    ) {
      return res.status(401).json({ error: { code: error.message, message: "Token rejected." } });
    }
    return next(error);
  }
});

documentsRouter.get("/_blob/:token", async (req, res, next) => {
  try {
    const payload = verifyToken(req.params.token);
    if (payload.o !== "get") {
      return res.status(403).json({
        error: { code: "wrong_token_op", message: "Token is not valid for download." }
      });
    }
    const document = await prisma.document.findUnique({ where: { id: payload.d } });
    if (!document || document.storageKey !== payload.k) {
      return res.status(404).json({
        error: { code: "document_not_found", message: "Document does not exist." }
      });
    }
    if (
      document.status === DocumentStatus.pending_upload ||
      document.status === DocumentStatus.quarantined
    ) {
      return res.status(409).json({
        error: {
          code: "document_not_downloadable",
          message: `Document status ${document.status} disallows download.`
        }
      });
    }
    res.setHeader("Content-Type", document.contentType ?? "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${document.fileName.replace(/"/g, "")}"`
    );
    if (document.blobSize != null) {
      res.setHeader("Content-Length", String(document.blobSize));
    }
    return readBlobStream(document.storageKey).pipe(res);
  } catch (error) {
    if (
      error instanceof Error &&
      ["invalid_token", "invalid_token_signature", "token_expired"].includes(error.message)
    ) {
      return res.status(401).json({ error: { code: error.message, message: "Token rejected." } });
    }
    return next(error);
  }
});

// ----- Tenant-scoped endpoints below -----
documentsRouter.use(requireTenantContext);

const listDocumentSelect = {
  id: true,
  organizationId: true,
  uploadedByUserId: true,
  kind: true,
  status: true,
  fileName: true,
  contentType: true,
  declaredSize: true,
  blobSize: true,
  blobSha256: true,
  storageProvider: true,
  storageKey: true,
  uploadedAt: true,
  finalizedAt: true,
  failureReason: true,
  metadataJson: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.DocumentSelect;

documentsRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const where: Prisma.DocumentWhereInput = {
      organizationId: tenant.organizationId
    };
    if (status && (Object.values(DocumentStatus) as string[]).includes(status)) {
      where.status = status as DocumentStatus;
    }
    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        ...listDocumentSelect,
        jobs: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            kind: true,
            status: true,
            attemptCount: true,
            maxAttempts: true,
            scheduledAt: true,
            startedAt: true,
            finishedAt: true,
            lastErrorMessage: true,
            resultJson: true
          }
        }
      }
    });
    res.json({ items: documents, organizationId: tenant.organizationId });
  } catch (error) {
    next(error);
  }
});

documentsRouter.post(
  "/",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert,
    OrganizationRole.worker
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createDocumentSchema.parse(req.body);
      const documentId = randomDocumentId();
      const storageKey = buildStorageKey(tenant.organizationId, documentId);
      const document = await prisma.document.create({
        data: {
          id: documentId,
          organizationId: tenant.organizationId,
          uploadedByUserId: tenant.userId,
          kind: payload.kind,
          fileName: payload.fileName,
          contentType: payload.contentType,
          declaredSize: payload.declaredSize,
          storageKey,
          metadataJson: payload.metadata as Prisma.InputJsonValue | undefined
        },
        select: listDocumentSelect
      });
      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "document",
        entityId: document.id,
        action: "document.created",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          fileName: document.fileName,
          kind: document.kind,
          declaredSize: document.declaredSize ?? null,
          storageProvider: document.storageProvider
        }
      });
      const upload = presignUpload(document.storageKey, document.id);
      res.status(201).json({ item: document, upload });
    } catch (error) {
      next(error);
    }
  }
);

documentsRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, organizationId: tenant.organizationId },
      select: {
        ...listDocumentSelect,
        jobs: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            kind: true,
            status: true,
            attemptCount: true,
            maxAttempts: true,
            scheduledAt: true,
            startedAt: true,
            finishedAt: true,
            lastErrorMessage: true,
            resultJson: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });
    if (!document) {
      return res.status(404).json({
        error: { code: "document_not_found", message: "Document not found in this organization." }
      });
    }
    res.json({ item: document });
  } catch (error) {
    next(error);
  }
});

documentsRouter.post("/:id/finalize", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, organizationId: tenant.organizationId }
    });
    if (!document) {
      return res.status(404).json({
        error: { code: "document_not_found", message: "Document not found in this organization." }
      });
    }
    if (document.status !== DocumentStatus.uploaded) {
      return res.status(409).json({
        error: {
          code: "document_not_finalizable",
          message: `Document must be in 'uploaded' status to finalize. Current: ${document.status}.`
        }
      });
    }
    const updated = await prisma.document.update({
      where: { id: document.id },
      data: { finalizedAt: new Date(), status: DocumentStatus.processing },
      select: listDocumentSelect
    });
    await prisma.documentJob.create({
      data: {
        documentId: document.id,
        organizationId: document.organizationId,
        kind: "validate_blob"
      }
    });
    await writeAuditEvent({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      entityType: "document",
      entityId: document.id,
      action: "document.finalized",
      payloadJson: {
        membershipId: tenant.membershipId,
        role: tenant.role,
        blobSize: updated.blobSize ?? null
      }
    });
    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
});

documentsRouter.get("/:id/download-url", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, organizationId: tenant.organizationId }
    });
    if (!document) {
      return res.status(404).json({
        error: { code: "document_not_found", message: "Document not found in this organization." }
      });
    }
    if (
      document.status === DocumentStatus.pending_upload ||
      document.status === DocumentStatus.quarantined
    ) {
      return res.status(409).json({
        error: {
          code: "document_not_downloadable",
          message: `Document status ${document.status} disallows download.`
        }
      });
    }
    const target = presignDownload(document.storageKey, document.id);
    res.json({ download: target, documentId: document.id });
  } catch (error) {
    next(error);
  }
});

documentsRouter.post(
  "/:id/jobs/:jobId/retry",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const job = await prisma.documentJob.findFirst({
        where: {
          id: String(req.params.jobId),
          documentId: String(req.params.id),
          organizationId: tenant.organizationId
        }
      });
      if (!job) {
        return res
          .status(404)
          .json({ error: { code: "job_not_found", message: "Job not found." } });
      }
      if (job.status !== DocumentJobStatus.failed && job.status !== DocumentJobStatus.dead_letter) {
        return res.status(409).json({
          error: {
            code: "job_not_retryable",
            message: `Job in status ${job.status} cannot be retried.`
          }
        });
      }
      const updated = await prisma.documentJob.update({
        where: { id: job.id },
        data: {
          status: DocumentJobStatus.pending,
          scheduledAt: new Date(),
          attemptCount: 0,
          finishedAt: null,
          startedAt: null,
          lastErrorMessage: null
        }
      });
      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "document_job",
        entityId: job.id,
        action: "document_job.retried",
        payloadJson: {
          documentId: job.documentId,
          membershipId: tenant.membershipId,
          role: tenant.role
        }
      });
      res.json({ item: updated });
    } catch (error) {
      next(error);
    }
  }
);

documentsRouter.post(
  "/_jobs/run",
  requireOrganizationRole([OrganizationRole.admin]),
  async (_req, res, next) => {
    try {
      const result = await runDueJobs(20);
      res.json({ result });
    } catch (error) {
      next(error);
    }
  }
);

// Local helpers ---------------------------------------------------------------

import express from "express";
import { randomUUID } from "node:crypto";

function randomDocumentId(): string {
  // Mirror cuid-like compactness without colliding with Prisma defaults.
  return `doc_${randomUUID().replace(/-/g, "")}`;
}
