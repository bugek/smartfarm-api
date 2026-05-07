import { Router } from "express";
import {
  OrganizationRole,
  Prisma,
  RetentionExecutionActorType,
  RetentionExecutionDecision,
  RetentionSubjectType
} from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

const subjectTypeValues = Object.values(RetentionSubjectType) as [
  RetentionSubjectType,
  ...RetentionSubjectType[]
];
const executionDecisionValues = Object.values(RetentionExecutionDecision) as [
  RetentionExecutionDecision,
  ...RetentionExecutionDecision[]
];
const executionActorTypeValues = Object.values(RetentionExecutionActorType) as [
  RetentionExecutionActorType,
  ...RetentionExecutionActorType[]
];

const retentionAdminRoles = [OrganizationRole.admin];
const retentionHoldRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert
];

const policyBaseSchema = z.object({
    subjectType: z.enum(subjectTypeValues),
    retainDays: z.number().int().positive(),
    archiveAfterDays: z.number().int().positive().nullable().optional(),
    purgeAfterDays: z.number().int().positive().nullable().optional(),
    legalBasis: z.string().trim().min(1).max(1000).nullable().optional(),
    activeFrom: z.coerce.date().optional(),
    activeTo: z.coerce.date().nullable().optional(),
    isDefault: z.boolean().optional()
  });

const policySchema = policyBaseSchema
  .refine(
    (payload) =>
      payload.archiveAfterDays == null ||
      payload.purgeAfterDays == null ||
      payload.archiveAfterDays <= payload.purgeAfterDays,
    { message: "archiveAfterDays must be less than or equal to purgeAfterDays." }
  );

const patchPolicySchema = policyBaseSchema.partial().refine((payload) => Object.keys(payload).length > 0, {
  message: "At least one field must be provided."
});

const createHoldSchema = z.object({
  subjectType: z.enum(subjectTypeValues),
  subjectId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(2000)
});

const releaseHoldSchema = z.object({
  releaseReason: z.string().trim().min(1).max(2000)
});

const candidatesQuerySchema = z.object({
  subjectType: z.enum(subjectTypeValues).optional(),
  decision: z.enum(executionDecisionValues).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const createExecutionSchema = z.object({
  subjectType: z.enum(subjectTypeValues),
  subjectId: z.string().trim().min(1),
  policyId: z.string().trim().min(1),
  decision: z.enum(executionDecisionValues),
  actorType: z.enum(executionActorTypeValues).optional(),
  evidence: z.record(z.any()).optional()
});

export const retentionRouter = Router();

retentionRouter.use(requireTenantContext);

retentionRouter.get("/policies", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const subjectType = typeof req.query.subjectType === "string" ? req.query.subjectType : undefined;
    const policies = await prisma.retentionPolicy.findMany({
      where: {
        OR: [{ organizationId: tenant.organizationId }, { organizationId: null }],
        ...(subjectType && (Object.values(RetentionSubjectType) as string[]).includes(subjectType)
          ? { subjectType: subjectType as RetentionSubjectType }
          : {})
      },
      orderBy: [{ organizationId: "desc" }, { subjectType: "asc" }, { activeFrom: "desc" }]
    });
    res.json({ items: policies, organizationId: tenant.organizationId });
  } catch (error) {
    next(error);
  }
});

retentionRouter.post(
  "/policies",
  requireOrganizationRole(retentionAdminRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = policySchema.parse(req.body);
      const item = await prisma.$transaction(async (tx) => {
        const policy = await tx.retentionPolicy.create({
          data: {
            organizationId: tenant.organizationId,
            subjectType: payload.subjectType,
            retainDays: payload.retainDays,
            archiveAfterDays: payload.archiveAfterDays ?? null,
            purgeAfterDays: payload.purgeAfterDays ?? null,
            legalBasis: payload.legalBasis ?? null,
            activeFrom: payload.activeFrom ?? new Date(),
            activeTo: payload.activeTo ?? null,
            isDefault: payload.isDefault ?? false,
            createdByUserId: tenant.userId
          }
        });
        await writeRetentionAudit(tx, tenant, "retention_policy", policy.id, "retention_policy.created", {
          subjectType: policy.subjectType,
          retainDays: policy.retainDays,
          archiveAfterDays: policy.archiveAfterDays,
          purgeAfterDays: policy.purgeAfterDays
        });
        await writeRetentionEvent(tx, tenant, "retention.policy_created", {
          policyId: policy.id,
          subjectType: policy.subjectType
        });
        return policy;
      });
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

retentionRouter.patch(
  "/policies/:id",
  requireOrganizationRole(retentionAdminRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = patchPolicySchema.parse(req.body);
      const existing = await prisma.retentionPolicy.findFirst({
        where: { id: String(req.params.id), organizationId: tenant.organizationId }
      });
      if (!existing) {
        return res.status(404).json({ error: { code: "retention_policy_not_found", message: "Retention policy was not found in this organization." } });
      }
      const item = await prisma.$transaction(async (tx) => {
        const policy = await tx.retentionPolicy.update({
          where: { id: existing.id },
          data: {
            ...(payload.subjectType !== undefined ? { subjectType: payload.subjectType } : {}),
            ...(payload.retainDays !== undefined ? { retainDays: payload.retainDays } : {}),
            ...(payload.archiveAfterDays !== undefined ? { archiveAfterDays: payload.archiveAfterDays } : {}),
            ...(payload.purgeAfterDays !== undefined ? { purgeAfterDays: payload.purgeAfterDays } : {}),
            ...(payload.legalBasis !== undefined ? { legalBasis: payload.legalBasis } : {}),
            ...(payload.activeFrom !== undefined ? { activeFrom: payload.activeFrom } : {}),
            ...(payload.activeTo !== undefined ? { activeTo: payload.activeTo } : {}),
            ...(payload.isDefault !== undefined ? { isDefault: payload.isDefault } : {})
          }
        });
        await writeRetentionAudit(tx, tenant, "retention_policy", policy.id, "retention_policy.updated", {
          previousSubjectType: existing.subjectType,
          nextSubjectType: policy.subjectType,
          previousRetainDays: existing.retainDays,
          nextRetainDays: policy.retainDays
        });
        return policy;
      });
      res.json({ item });
    } catch (error) {
      next(error);
    }
  }
);

retentionRouter.post(
  "/holds",
  requireOrganizationRole(retentionHoldRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createHoldSchema.parse(req.body);
      const subject = await resolveRetentionSubject(tenant.organizationId, payload.subjectType, payload.subjectId);
      if (!subject.exists) {
        return res.status(404).json({ error: { code: "retention_subject_not_found", message: "Retention subject was not found in this organization." } });
      }
      const item = await prisma.$transaction(async (tx) => {
        const hold = await tx.retentionHold.create({
          data: {
            organizationId: tenant.organizationId,
            subjectType: payload.subjectType,
            subjectId: payload.subjectId,
            reason: payload.reason,
            requestedByUserId: tenant.userId
          }
        });
        await writeRetentionAudit(tx, tenant, "retention_hold", hold.id, "retention_hold.created", {
          subjectType: hold.subjectType,
          subjectId: hold.subjectId,
          reason: hold.reason
        });
        await writeRetentionEvent(tx, tenant, "retention.hold_created", {
          holdId: hold.id,
          subjectType: hold.subjectType,
          subjectId: hold.subjectId
        });
        return hold;
      });
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

retentionRouter.post(
  "/holds/:id/release",
  requireOrganizationRole(retentionHoldRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = releaseHoldSchema.parse(req.body);
      const existing = await prisma.retentionHold.findFirst({
        where: { id: String(req.params.id), organizationId: tenant.organizationId }
      });
      if (!existing) {
        return res.status(404).json({ error: { code: "retention_hold_not_found", message: "Retention hold was not found in this organization." } });
      }
      if (existing.releasedAt) {
        return res.status(409).json({ error: { code: "retention_hold_already_released", message: "Retention hold has already been released." } });
      }
      const item = await prisma.$transaction(async (tx) => {
        const hold = await tx.retentionHold.update({
          where: { id: existing.id },
          data: {
            releasedAt: new Date(),
            releasedByUserId: tenant.userId,
            releaseReason: payload.releaseReason
          }
        });
        await writeRetentionAudit(tx, tenant, "retention_hold", hold.id, "retention_hold.released", {
          subjectType: hold.subjectType,
          subjectId: hold.subjectId,
          releaseReason: hold.releaseReason
        });
        await writeRetentionEvent(tx, tenant, "retention.hold_released", {
          holdId: hold.id,
          subjectType: hold.subjectType,
          subjectId: hold.subjectId
        });
        return hold;
      });
      res.json({ item });
    } catch (error) {
      next(error);
    }
  }
);

retentionRouter.get("/candidates", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const query = candidatesQuerySchema.parse(req.query);
    const items = await buildRetentionCandidates(
      tenant.organizationId,
      query.subjectType,
      query.decision,
      query.limit ?? 100
    );
    res.json({ items, organizationId: tenant.organizationId });
  } catch (error) {
    next(error);
  }
});

retentionRouter.post(
  "/executions",
  requireOrganizationRole(retentionAdminRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createExecutionSchema.parse(req.body);
      const [policy, subject, activeHold] = await Promise.all([
        prisma.retentionPolicy.findFirst({
          where: {
            id: payload.policyId,
            OR: [{ organizationId: tenant.organizationId }, { organizationId: null }]
          }
        }),
        resolveRetentionSubject(tenant.organizationId, payload.subjectType, payload.subjectId),
        prisma.retentionHold.findFirst({
          where: {
            organizationId: tenant.organizationId,
            subjectType: payload.subjectType,
            subjectId: payload.subjectId,
            releasedAt: null
          },
          select: { id: true }
        })
      ]);
      if (!policy) {
        return res.status(404).json({ error: { code: "retention_policy_not_found", message: "Retention policy was not found for this organization." } });
      }
      if (policy.subjectType !== payload.subjectType) {
        return res.status(409).json({ error: { code: "retention_policy_subject_mismatch", message: "Retention policy subject type does not match the execution subject type." } });
      }
      if (!subject.exists) {
        return res.status(404).json({ error: { code: "retention_subject_not_found", message: "Retention subject was not found in this organization." } });
      }
      if (
        activeHold &&
        (payload.decision === RetentionExecutionDecision.archived ||
          payload.decision === RetentionExecutionDecision.purged)
      ) {
        return res.status(409).json({
          error: {
            code: "retention_subject_on_hold",
            message: "Subject has an active retention hold. Record skipped_hold instead of archive/purge."
          }
        });
      }

      const item = await prisma.$transaction(async (tx) => {
        const execution = await tx.retentionExecution.create({
          data: {
            organizationId: tenant.organizationId,
            subjectType: payload.subjectType,
            subjectId: payload.subjectId,
            policyId: policy.id,
            decision: payload.decision,
            actorType: payload.actorType ?? RetentionExecutionActorType.user,
            actorUserId: tenant.userId,
            evidenceJson: {
              ...(payload.evidence ?? {}),
              activeHoldId: activeHold?.id ?? null
            } as Prisma.InputJsonValue
          }
        });
        await writeRetentionAudit(tx, tenant, "retention_execution", execution.id, `retention_execution.${execution.decision}`, {
          subjectType: execution.subjectType,
          subjectId: execution.subjectId,
          policyId: execution.policyId,
          decision: execution.decision
        });
        await writeRetentionEvent(tx, tenant, `retention.${execution.decision}`, {
          executionId: execution.id,
          subjectType: execution.subjectType,
          subjectId: execution.subjectId,
          policyId: execution.policyId
        });
        return execution;
      });
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

async function buildRetentionCandidates(
  organizationId: string,
  subjectType: RetentionSubjectType | undefined,
  requestedDecision: RetentionExecutionDecision | undefined,
  limit: number
) {
  const policies = await prisma.retentionPolicy.findMany({
    where: {
      OR: [{ organizationId }, { organizationId: null }],
      ...(subjectType ? { subjectType } : {}),
      activeFrom: { lte: new Date() },
      activeTo: null
    },
    orderBy: [{ organizationId: "desc" }, { activeFrom: "desc" }]
  });
  const seenSubjectTypes = new Set<RetentionSubjectType>();
  const candidates: any[] = [];

  for (const policy of policies) {
    if (seenSubjectTypes.has(policy.subjectType)) {
      continue;
    }
    seenSubjectTypes.add(policy.subjectType);
    const candidateDecision = requestedDecision ?? deriveCandidateDecision(policy);
    if (!candidateDecision) {
      continue;
    }
    const dueAt = deriveDueAt(policy, candidateDecision);
    if (!dueAt) {
      continue;
    }
    const subjects = await listRetentionSubjects(organizationId, policy.subjectType, dueAt, limit);
    for (const subject of subjects) {
      const activeHold = await prisma.retentionHold.findFirst({
        where: {
          organizationId,
          subjectType: policy.subjectType,
          subjectId: subject.id,
          releasedAt: null
        },
        select: { id: true, reason: true, createdAt: true }
      });
      candidates.push({
        subjectType: policy.subjectType,
        subjectId: subject.id,
        subjectCreatedAt: subject.createdAt,
        policyId: policy.id,
        decision: activeHold ? RetentionExecutionDecision.skipped_hold : candidateDecision,
        dueBefore: dueAt,
        activeHold
      });
      if (candidates.length >= limit) {
        return candidates;
      }
    }
  }

  return candidates;
}

function deriveCandidateDecision(policy: {
  archiveAfterDays: number | null;
  purgeAfterDays: number | null;
}) {
  if (policy.purgeAfterDays != null) {
    return RetentionExecutionDecision.purged;
  }
  if (policy.archiveAfterDays != null) {
    return RetentionExecutionDecision.archived;
  }
  return null;
}

function deriveDueAt(
  policy: {
    archiveAfterDays: number | null;
    purgeAfterDays: number | null;
  },
  decision: RetentionExecutionDecision
) {
  const days =
    decision === RetentionExecutionDecision.purged
      ? policy.purgeAfterDays
      : decision === RetentionExecutionDecision.archived
        ? policy.archiveAfterDays
        : null;
  return days == null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function listRetentionSubjects(
  organizationId: string,
  subjectType: RetentionSubjectType,
  dueAt: Date,
  limit: number
) {
  const where = { organizationId, createdAt: { lte: dueAt } };
  switch (subjectType) {
    case RetentionSubjectType.gap_record:
      return prisma.gapRecord.findMany({ where, take: limit, select: { id: true, createdAt: true } });
    case RetentionSubjectType.evidence:
      return prisma.evidence.findMany({ where, take: limit, select: { id: true, createdAt: true } });
    case RetentionSubjectType.document:
      return prisma.document.findMany({ where, take: limit, select: { id: true, createdAt: true } });
    case RetentionSubjectType.trace_lot:
      return prisma.traceLot.findMany({ where, take: limit, select: { id: true, createdAt: true } });
    case RetentionSubjectType.trace_dispatch:
      return prisma.traceDispatch.findMany({ where, take: limit, select: { id: true, createdAt: true } });
    case RetentionSubjectType.traceability_exercise:
      return prisma.traceabilityExercise.findMany({ where, take: limit, select: { id: true, createdAt: true } });
    default:
      return [];
  }
}

async function resolveRetentionSubject(
  organizationId: string,
  subjectType: RetentionSubjectType,
  subjectId: string
) {
  switch (subjectType) {
    case RetentionSubjectType.gap_record:
      return { exists: Boolean(await prisma.gapRecord.findFirst({ where: { id: subjectId, organizationId }, select: { id: true } })) };
    case RetentionSubjectType.evidence:
      return { exists: Boolean(await prisma.evidence.findFirst({ where: { id: subjectId, organizationId }, select: { id: true } })) };
    case RetentionSubjectType.document:
      return { exists: Boolean(await prisma.document.findFirst({ where: { id: subjectId, organizationId }, select: { id: true } })) };
    case RetentionSubjectType.trace_lot:
      return { exists: Boolean(await prisma.traceLot.findFirst({ where: { id: subjectId, organizationId }, select: { id: true } })) };
    case RetentionSubjectType.trace_dispatch:
      return { exists: Boolean(await prisma.traceDispatch.findFirst({ where: { id: subjectId, organizationId }, select: { id: true } })) };
    case RetentionSubjectType.traceability_exercise:
      return { exists: Boolean(await prisma.traceabilityExercise.findFirst({ where: { id: subjectId, organizationId }, select: { id: true } })) };
    default:
      return { exists: true };
  }
}

async function writeRetentionAudit(
  tx: Prisma.TransactionClient,
  tenant: ReturnType<typeof getTenantContext>,
  entityType: string,
  entityId: string,
  action: string,
  payloadJson: Prisma.InputJsonValue
) {
  await tx.auditEvent.create({
    data: {
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      entityType,
      entityId,
      action,
      payloadJson: {
        membershipId: tenant.membershipId,
        role: tenant.role,
        ...((payloadJson as Prisma.JsonObject) ?? {})
      }
    }
  });
}

async function writeRetentionEvent(
  tx: Prisma.TransactionClient,
  tenant: ReturnType<typeof getTenantContext>,
  eventType: string,
  payloadJson: Prisma.InputJsonValue
) {
  await tx.traceabilityEvent.create({
    data: {
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      eventType,
      occurredAt: new Date(),
      payloadJson
    }
  });
}
