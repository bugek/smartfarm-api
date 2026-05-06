import type { DocumentJob, DocumentJobKind } from "@prisma/client";
import { DocumentJobStatus, DocumentStatus, Prisma } from "@prisma/client";
import { writeAuditEvent } from "./audit.js";
import { prisma } from "./prisma.js";
import { hashBlob, statBlob } from "./storage.js";

type JobHandlerResult = {
  resultJson?: Prisma.InputJsonValue;
};

type JobHandler = (job: DocumentJob) => Promise<JobHandlerResult>;

const DEFAULT_BACKOFF_SECONDS = [10, 60, 300, 900];

function backoffSeconds(attempt: number): number {
  return DEFAULT_BACKOFF_SECONDS[Math.min(attempt, DEFAULT_BACKOFF_SECONDS.length - 1)];
}

const handlers: Record<DocumentJobKind, JobHandler> = {
  validate_blob: async (job) => {
    const document = await prisma.document.findUnique({ where: { id: job.documentId } });
    if (!document) {
      throw new Error("document_not_found");
    }
    const stats = await statBlob(document.storageKey);
    if (!stats) {
      throw new Error("blob_missing");
    }
    if (document.declaredSize != null && stats.size !== document.declaredSize) {
      throw new Error(
        `blob_size_mismatch declared=${document.declaredSize} actual=${stats.size}`
      );
    }
    const hashed = await hashBlob(document.storageKey);
    if (!hashed) {
      throw new Error("blob_missing_during_hash");
    }
    await prisma.document.update({
      where: { id: document.id },
      data: {
        blobSize: hashed.size,
        blobSha256: hashed.sha256,
        status: DocumentStatus.processing
      }
    });
    // Schedule the next placeholder extraction job.
    await prisma.documentJob.create({
      data: {
        documentId: document.id,
        organizationId: document.organizationId,
        kind: "extract_text"
      }
    });
    return {
      resultJson: {
        blobSize: hashed.size,
        blobSha256: hashed.sha256
      }
    };
  },
  extract_text: async (job) => {
    const document = await prisma.document.findUnique({ where: { id: job.documentId } });
    if (!document) {
      throw new Error("document_not_found");
    }
    // Placeholder: real OCR/extraction lives in a future issue. Mark ready so reviewers
    // can act, while still leaving an explicit job record for traceability.
    await prisma.document.update({
      where: { id: document.id },
      data: {
        status: DocumentStatus.ready
      }
    });
    await writeAuditEvent({
      organizationId: document.organizationId,
      entityType: "document",
      entityId: document.id,
      action: "document.ready",
      payloadJson: {
        kind: document.kind,
        fileName: document.fileName,
        blobSize: document.blobSize ?? null,
        blobSha256: document.blobSha256 ?? null
      }
    });
    return {
      resultJson: {
        extractor: "placeholder",
        note: "extraction deferred to future issue"
      }
    };
  }
};

async function claimNextJob(now: Date): Promise<DocumentJob | null> {
  // Single-worker model: simple SELECT ... FOR UPDATE SKIP LOCKED via transaction.
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<DocumentJob[]>`
      SELECT * FROM "DocumentJob"
      WHERE "status" IN ('pending', 'retrying')
        AND "scheduledAt" <= ${now}
      ORDER BY "scheduledAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }
    return tx.documentJob.update({
      where: { id: candidate.id },
      data: {
        status: DocumentJobStatus.running,
        startedAt: now,
        attemptCount: candidate.attemptCount + 1
      }
    });
  });
}

async function recordSuccess(job: DocumentJob, result: JobHandlerResult): Promise<void> {
  await prisma.documentJob.update({
    where: { id: job.id },
    data: {
      status: DocumentJobStatus.succeeded,
      finishedAt: new Date(),
      resultJson: result.resultJson ?? Prisma.JsonNull,
      lastErrorMessage: null
    }
  });
}

async function recordFailure(job: DocumentJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const isFinal = job.attemptCount >= job.maxAttempts;
  const now = new Date();
  await prisma.documentJob.update({
    where: { id: job.id },
    data: {
      status: isFinal ? DocumentJobStatus.dead_letter : DocumentJobStatus.retrying,
      finishedAt: isFinal ? now : null,
      scheduledAt: isFinal
        ? job.scheduledAt
        : new Date(now.getTime() + backoffSeconds(job.attemptCount) * 1000),
      lastErrorMessage: message
    }
  });
  if (isFinal) {
    const document = await prisma.document.findUnique({ where: { id: job.documentId } });
    if (document) {
      await prisma.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.failed,
          failureReason: `${job.kind}:${message}`
        }
      });
      await writeAuditEvent({
        organizationId: document.organizationId,
        entityType: "document",
        entityId: document.id,
        action: "document.job_dead_lettered",
        payloadJson: {
          jobId: job.id,
          kind: job.kind,
          attempts: job.attemptCount,
          message
        }
      });
    }
  }
}

export type JobRunResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

export async function runDueJobs(maxJobs: number = 10): Promise<JobRunResult> {
  const result: JobRunResult = { processed: 0, succeeded: 0, failed: 0 };
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextJob(new Date());
    if (!job) {
      break;
    }
    result.processed += 1;
    const handler = handlers[job.kind];
    if (!handler) {
      await recordFailure(job, new Error(`no_handler_for_${job.kind}`));
      result.failed += 1;
      continue;
    }
    try {
      const handlerResult = await handler(job);
      await recordSuccess(job, handlerResult);
      result.succeeded += 1;
    } catch (error) {
      await recordFailure(job, error);
      result.failed += 1;
    }
  }
  return result;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startJobRunner(intervalMs: number = 5_000): void {
  if (timer) {
    return;
  }
  timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runDueJobs();
    } catch (err) {
      console.error("[jobs] runDueJobs failed", err);
    } finally {
      running = false;
    }
  }, intervalMs);
  // Don't keep the process alive solely for the runner.
  timer.unref?.();
}

export function stopJobRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Re-export Prisma helper to avoid circular import from callers needing JsonNull above.
