import express, { Router } from "express";
import { CorrectiveActionStatus, OrganizationRole, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";

const correctiveActionStatusValues = Object.values(CorrectiveActionStatus) as [
  CorrectiveActionStatus,
  ...CorrectiveActionStatus[]
];

const correctiveActionSelect = {
  id: true,
  organizationId: true,
  gapRecordId: true,
  title: true,
  details: true,
  controlPointRef: true,
  status: true,
  ownerUserId: true,
  createdByUserId: true,
  dueAt: true,
  assignedAt: true,
  submittedForReviewAt: true,
  verifiedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  gapRecord: {
    select: {
      id: true,
      title: true,
      checklist: {
        select: {
          code: true,
          title: true
        }
      }
    }
  },
  evidenceLinks: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      evidenceId: true,
      createdAt: true,
      evidence: {
        select: {
          id: true,
          fileName: true,
          kind: true,
          reviewStatus: true,
          submittedAt: true
        }
      }
    }
  }
} satisfies Prisma.CorrectiveActionSelect;

type CorrectiveActionPayload = Prisma.CorrectiveActionGetPayload<{
  select: typeof correctiveActionSelect;
}>;

type IdentityMap = Map<
  string,
  {
    name: string;
    role: string | null;
  }
>;

const createCorrectiveActionSchema = z.object({
  gapRecordId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().min(1).max(4000),
  dueAt: z.coerce.date(),
  ownerUserId: z.string().trim().min(1).optional(),
  evidenceIds: z.array(z.string().trim().min(1)).max(50).optional()
});

const listCorrectiveActionsQuerySchema = z.object({
  gapRecordId: z.string().trim().min(1).optional(),
  status: z.enum(correctiveActionStatusValues).optional(),
  ownerUserId: z.string().trim().min(1).optional(),
  overdue: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
});

const assignCorrectiveActionSchema = z.object({
  ownerUserId: z.string().trim().min(1).nullable().optional(),
  dueAt: z.coerce.date().optional()
});

const submitCorrectiveActionSchema = z.object({
  evidenceIds: z.array(z.string().trim().min(1)).max(50).optional()
});

const verifyCorrectiveActionSchema = z.object({
  comment: z.string().trim().min(1).max(2000).optional()
});

const closeCorrectiveActionSchema = z.object({
  comment: z.string().trim().min(1).max(2000).optional()
});

const reopenCorrectiveActionSchema = z.object({
  ownerUserId: z.string().trim().min(1).nullable().optional(),
  dueAt: z.coerce.date().optional()
});

export const correctiveActionsRouter = Router();

correctiveActionsRouter.use(express.json());
correctiveActionsRouter.use(requireTenantContext);

correctiveActionsRouter.get("/", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listCorrectiveActionsQuerySchema.parse(req.query);
    const now = new Date();

    const where: Prisma.CorrectiveActionWhereInput = {
      organizationId: tenant.organizationId
    };

    if (filters.gapRecordId) {
      where.gapRecordId = filters.gapRecordId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.ownerUserId) {
      where.ownerUserId = filters.ownerUserId;
    }

    if (filters.overdue === true) {
      where.dueAt = { lt: now };
      where.status = {
        not: CorrectiveActionStatus.closed
      };
    }

    const items = await prisma.correctiveAction.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 200,
      select: correctiveActionSelect
    });

    const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds(items));

    res.json({
      organizationId: tenant.organizationId,
      filters: {
        gapRecordId: filters.gapRecordId ?? null,
        status: filters.status ?? null,
        ownerUserId: filters.ownerUserId ?? null,
        overdue: filters.overdue ?? false
      },
      items: items.map((item) => serializeCorrectiveAction(item, identities))
    });
  } catch (error) {
    next(error);
  }
});

correctiveActionsRouter.get("/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const action = await prisma.correctiveAction.findFirst({
      where: {
        id: String(req.params.id),
        organizationId: tenant.organizationId
      },
      select: correctiveActionSelect
    });

    if (!action) {
      return res.status(404).json({
        error: {
          code: "corrective_action_not_found",
          message: "Corrective action not found in this organization."
        }
      });
    }

    const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds([action]));

    res.json({
      item: serializeCorrectiveAction(action, identities)
    });
  } catch (error) {
    next(error);
  }
});

correctiveActionsRouter.post(
  "/",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createCorrectiveActionSchema.parse(req.body);
      const now = new Date();

      const gapRecord = await prisma.gapRecord.findFirst({
        where: {
          id: payload.gapRecordId,
          organizationId: tenant.organizationId
        },
        select: {
          id: true,
          checklist: {
            select: {
              code: true
            }
          }
        }
      });

      if (!gapRecord) {
        return res.status(404).json({
          error: {
            code: "gap_record_not_found",
            message: "GAP record not found in this organization."
          }
        });
      }

      const evidenceIds = normalizeDistinctIds(payload.evidenceIds);
      const evidenceValidationError = await validateCorrectiveActionEvidence(
        tenant.organizationId,
        gapRecord.id,
        evidenceIds
      );
      if (evidenceValidationError) {
        return res.status(400).json({
          error: {
            code: "corrective_action_evidence_invalid",
            message: evidenceValidationError
          }
        });
      }

      const action = await prisma.$transaction(async (tx): Promise<CorrectiveActionPayload> => {
        const created = await tx.correctiveAction.create({
          data: {
            organizationId: tenant.organizationId,
            gapRecordId: gapRecord.id,
            title: payload.title,
            details: payload.details,
            controlPointRef: gapRecord.checklist?.code ?? null,
            status: payload.ownerUserId
              ? CorrectiveActionStatus.assigned
              : CorrectiveActionStatus.open_unassigned,
            ownerUserId: payload.ownerUserId ?? null,
            createdByUserId: tenant.userId,
            dueAt: payload.dueAt,
            assignedAt: payload.ownerUserId ? now : null
          },
          select: correctiveActionSelect
        });

        if (evidenceIds.length > 0) {
          await tx.correctiveActionEvidence.createMany({
            data: evidenceIds.map((evidenceId) => ({
              correctiveActionId: created.id,
              evidenceId,
              organizationId: tenant.organizationId
            })),
            skipDuplicates: true
          });
        }

        return tx.correctiveAction.findUniqueOrThrow({
          where: { id: created.id },
          select: correctiveActionSelect
        });
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "corrective_action",
        entityId: action.id,
        action: "corrective_action.created",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          gapRecordId: action.gapRecordId,
          controlPointRef: action.controlPointRef,
          ownerUserId: action.ownerUserId,
          dueAt: action.dueAt.toISOString(),
          evidenceIds
        }
      });

      const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds([action]));

      res.status(201).json({
        item: serializeCorrectiveAction(action, identities)
      });
    } catch (error) {
      next(error);
    }
  }
);

correctiveActionsRouter.patch(
  "/:id/assign",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = assignCorrectiveActionSchema.parse(req.body);
      const existing = await findCorrectiveActionForTenant(tenant.organizationId, String(req.params.id));

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "corrective_action_not_found",
            message: "Corrective action not found in this organization."
          }
        });
      }

      if (
        existing.status !== CorrectiveActionStatus.open_unassigned &&
        existing.status !== CorrectiveActionStatus.assigned
      ) {
        return res.status(409).json({
          error: {
            code: "corrective_action_assignment_conflict",
            message: `Corrective action in status '${existing.status}' cannot be reassigned through this route.`
          }
        });
      }

      const ownerUserId = payload.ownerUserId === undefined ? existing.ownerUserId : payload.ownerUserId;
      const nextStatus = ownerUserId
        ? CorrectiveActionStatus.assigned
        : CorrectiveActionStatus.open_unassigned;
      const action = await prisma.correctiveAction.update({
        where: { id: existing.id },
        data: {
          ownerUserId: ownerUserId ?? null,
          dueAt: payload.dueAt ?? existing.dueAt,
          status: nextStatus,
          assignedAt: ownerUserId ? existing.assignedAt ?? new Date() : null
        },
        select: correctiveActionSelect
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "corrective_action",
        entityId: action.id,
        action: "corrective_action.assigned",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          previousStatus: existing.status,
          nextStatus,
          ownerUserId: action.ownerUserId,
          dueAt: action.dueAt.toISOString()
        }
      });

      const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds([action]));

      res.json({
        item: serializeCorrectiveAction(action, identities)
      });
    } catch (error) {
      next(error);
    }
  }
);

correctiveActionsRouter.post(
  "/:id/submit",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert,
    OrganizationRole.worker
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = submitCorrectiveActionSchema.parse(req.body);
      const existing = await findCorrectiveActionForTenant(tenant.organizationId, String(req.params.id));

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "corrective_action_not_found",
            message: "Corrective action not found in this organization."
          }
        });
      }

      if (existing.status !== CorrectiveActionStatus.assigned) {
        return res.status(409).json({
          error: {
            code: "corrective_action_submit_conflict",
            message: `Corrective action in status '${existing.status}' cannot be submitted for review.`
          }
        });
      }

      if (!existing.ownerUserId) {
        return res.status(409).json({
          error: {
            code: "corrective_action_owner_required",
            message: "Assign the corrective action before submitting it for review."
          }
        });
      }

      if (tenant.role === OrganizationRole.worker && existing.ownerUserId !== tenant.userId) {
        return res.status(403).json({
          error: {
            code: "corrective_action_submit_forbidden",
            message: "Workers can only submit corrective actions assigned to themselves."
          }
        });
      }

      const evidenceIds = normalizeDistinctIds(payload.evidenceIds);
      const evidenceValidationError = await validateCorrectiveActionEvidence(
        tenant.organizationId,
        existing.gapRecordId,
        evidenceIds
      );
      if (evidenceValidationError) {
        return res.status(400).json({
          error: {
            code: "corrective_action_evidence_invalid",
            message: evidenceValidationError
          }
        });
      }

      const action = await prisma.$transaction(async (tx): Promise<CorrectiveActionPayload> => {
        if (evidenceIds.length > 0) {
          await tx.correctiveActionEvidence.createMany({
            data: evidenceIds.map((evidenceId) => ({
              correctiveActionId: existing.id,
              evidenceId,
              organizationId: tenant.organizationId
            })),
            skipDuplicates: true
          });
        }

        return tx.correctiveAction.update({
          where: { id: existing.id },
          data: {
            status: CorrectiveActionStatus.submitted_for_review,
            submittedForReviewAt: new Date()
          },
          select: correctiveActionSelect
        });
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "corrective_action",
        entityId: action.id,
        action: "corrective_action.submitted_for_review",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          previousStatus: existing.status,
          nextStatus: action.status,
          evidenceIds
        }
      });

      const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds([action]));

      res.json({
        item: serializeCorrectiveAction(action, identities)
      });
    } catch (error) {
      next(error);
    }
  }
);

correctiveActionsRouter.post(
  "/:id/verify",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = verifyCorrectiveActionSchema.parse(req.body);
      const existing = await findCorrectiveActionForTenant(tenant.organizationId, String(req.params.id));

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "corrective_action_not_found",
            message: "Corrective action not found in this organization."
          }
        });
      }

      if (existing.status !== CorrectiveActionStatus.submitted_for_review) {
        return res.status(409).json({
          error: {
            code: "corrective_action_verify_conflict",
            message: `Corrective action in status '${existing.status}' cannot be verified.`
          }
        });
      }

      const action = await prisma.correctiveAction.update({
        where: { id: existing.id },
        data: {
          status: CorrectiveActionStatus.verified,
          verifiedAt: new Date()
        },
        select: correctiveActionSelect
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "corrective_action",
        entityId: action.id,
        action: "corrective_action.verified",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          previousStatus: existing.status,
          nextStatus: action.status,
          comment: payload.comment ?? null
        }
      });

      const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds([action]));

      res.json({
        item: serializeCorrectiveAction(action, identities)
      });
    } catch (error) {
      next(error);
    }
  }
);

correctiveActionsRouter.post(
  "/:id/close",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = closeCorrectiveActionSchema.parse(req.body);
      const existing = await findCorrectiveActionForTenant(tenant.organizationId, String(req.params.id));

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "corrective_action_not_found",
            message: "Corrective action not found in this organization."
          }
        });
      }

      if (existing.status !== CorrectiveActionStatus.verified) {
        return res.status(409).json({
          error: {
            code: "corrective_action_close_conflict",
            message: `Corrective action in status '${existing.status}' cannot be closed.`
          }
        });
      }

      const action = await prisma.correctiveAction.update({
        where: { id: existing.id },
        data: {
          status: CorrectiveActionStatus.closed,
          closedAt: new Date()
        },
        select: correctiveActionSelect
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "corrective_action",
        entityId: action.id,
        action: "corrective_action.closed",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          previousStatus: existing.status,
          nextStatus: action.status,
          comment: payload.comment ?? null
        }
      });

      const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds([action]));

      res.json({
        item: serializeCorrectiveAction(action, identities)
      });
    } catch (error) {
      next(error);
    }
  }
);

correctiveActionsRouter.post(
  "/:id/reopen",
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ]),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = reopenCorrectiveActionSchema.parse(req.body);
      const existing = await findCorrectiveActionForTenant(tenant.organizationId, String(req.params.id));

      if (!existing) {
        return res.status(404).json({
          error: {
            code: "corrective_action_not_found",
            message: "Corrective action not found in this organization."
          }
        });
      }

      if (
        existing.status !== CorrectiveActionStatus.submitted_for_review &&
        existing.status !== CorrectiveActionStatus.verified &&
        existing.status !== CorrectiveActionStatus.closed
      ) {
        return res.status(409).json({
          error: {
            code: "corrective_action_reopen_conflict",
            message: `Corrective action in status '${existing.status}' cannot be reopened through this route.`
          }
        });
      }

      const ownerUserId = payload.ownerUserId === undefined ? existing.ownerUserId : payload.ownerUserId;
      const nextStatus = ownerUserId
        ? CorrectiveActionStatus.assigned
        : CorrectiveActionStatus.open_unassigned;

      const action = await prisma.correctiveAction.update({
        where: { id: existing.id },
        data: {
          ownerUserId: ownerUserId ?? null,
          dueAt: payload.dueAt ?? existing.dueAt,
          status: nextStatus,
          submittedForReviewAt: null,
          verifiedAt: null,
          closedAt: null,
          assignedAt: ownerUserId ? existing.assignedAt ?? new Date() : null
        },
        select: correctiveActionSelect
      });

      await writeAuditEvent({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        entityType: "corrective_action",
        entityId: action.id,
        action: "corrective_action.reopened",
        payloadJson: {
          membershipId: tenant.membershipId,
          role: tenant.role,
          previousStatus: existing.status,
          nextStatus,
          ownerUserId: action.ownerUserId,
          dueAt: action.dueAt.toISOString()
        }
      });

      const identities = await loadIdentityMap(tenant.organizationId, collectIdentityUserIds([action]));

      res.json({
        item: serializeCorrectiveAction(action, identities)
      });
    } catch (error) {
      next(error);
    }
  }
);

async function findCorrectiveActionForTenant(organizationId: string, id: string) {
  return prisma.correctiveAction.findFirst({
    where: {
      id,
      organizationId
    },
    select: correctiveActionSelect
  });
}

async function validateCorrectiveActionEvidence(
  organizationId: string,
  gapRecordId: string,
  evidenceIds: string[]
) {
  if (evidenceIds.length === 0) {
    return null;
  }

  const evidences = await prisma.evidence.findMany({
    where: {
      organizationId,
      gapRecordId,
      id: {
        in: evidenceIds
      }
    },
    select: {
      id: true
    }
  });

  if (evidences.length !== evidenceIds.length) {
    return "Corrective action evidence must belong to the same organization and GAP record.";
  }

  return null;
}

function normalizeDistinctIds(ids?: string[]) {
  return [...new Set((ids ?? []).map((value) => value.trim()).filter(Boolean))];
}

function collectIdentityUserIds(actions: CorrectiveActionPayload[]) {
  const ids = new Set<string>();

  for (const action of actions) {
    ids.add(action.createdByUserId);
    if (action.ownerUserId) {
      ids.add(action.ownerUserId);
    }
  }

  return [...ids];
}

async function loadIdentityMap(organizationId: string, userIds: string[]): Promise<IdentityMap> {
  if (userIds.length === 0) {
    return new Map();
  }

  const memberships = await prisma.membership.findMany({
    where: {
      organizationId,
      userId: {
        in: userIds
      }
    },
    select: {
      userId: true,
      role: true,
      user: {
        select: {
          displayName: true,
          email: true
        }
      }
    }
  });

  return new Map(
    memberships.map((membership) => [
      membership.userId,
      {
        name: membership.user.displayName || membership.user.email,
        role: membership.role
      }
    ])
  );
}

function serializeCorrectiveAction(action: CorrectiveActionPayload, identities: IdentityMap) {
  const ownerIdentity = action.ownerUserId ? identities.get(action.ownerUserId) : null;
  const creatorIdentity = identities.get(action.createdByUserId);
  const now = Date.now();
  const isClosed = action.status === CorrectiveActionStatus.closed;
  const isOverdue = !isClosed && new Date(action.dueAt).getTime() < now;

  return {
    id: action.id,
    organizationId: action.organizationId,
    gapRecordId: action.gapRecordId,
    title: action.title,
    details: action.details,
    controlPointRef: action.controlPointRef ?? action.gapRecord.checklist?.code ?? null,
    controlPointTitle: action.gapRecord.checklist?.title ?? null,
    status: action.status,
    isOverdue,
    dueAt: action.dueAt,
    ownerUserId: action.ownerUserId,
    ownerName: ownerIdentity?.name ?? action.ownerUserId ?? null,
    ownerRole: ownerIdentity?.role ?? null,
    createdByUserId: action.createdByUserId,
    createdByName: creatorIdentity?.name ?? action.createdByUserId,
    createdByRole: creatorIdentity?.role ?? null,
    assignedAt: action.assignedAt,
    submittedForReviewAt: action.submittedForReviewAt,
    verifiedAt: action.verifiedAt,
    closedAt: action.closedAt,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    gapRecord: {
      id: action.gapRecord.id,
      title: action.gapRecord.title
    },
    evidenceLinks: action.evidenceLinks.map((link) => ({
      evidenceId: link.evidenceId,
      createdAt: link.createdAt,
      evidence: link.evidence
    }))
  };
}
