import { Router } from "express";
import {
  OrganizationRole,
  Prisma,
  TraceDispatchDestinationType,
  TraceDispatchStatus,
  TraceLotGapRecordLinkType,
  TraceLotLineageRelationshipType,
  TraceLotStatus,
  TraceabilityExerciseStatus
} from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";

const lotStatusValues = Object.values(TraceLotStatus) as [TraceLotStatus, ...TraceLotStatus[]];
const lineageRelationshipValues = Object.values(TraceLotLineageRelationshipType) as [
  TraceLotLineageRelationshipType,
  ...TraceLotLineageRelationshipType[]
];
const lotGapRecordLinkValues = Object.values(TraceLotGapRecordLinkType) as [
  TraceLotGapRecordLinkType,
  ...TraceLotGapRecordLinkType[]
];
const dispatchDestinationTypeValues = Object.values(TraceDispatchDestinationType) as [
  TraceDispatchDestinationType,
  ...TraceDispatchDestinationType[]
];
const dispatchStatusValues = Object.values(TraceDispatchStatus) as [
  TraceDispatchStatus,
  ...TraceDispatchStatus[]
];
const exerciseStatusValues = Object.values(TraceabilityExerciseStatus) as [
  TraceabilityExerciseStatus,
  ...TraceabilityExerciseStatus[]
];

const traceabilityWriteRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert,
  OrganizationRole.worker
];
const traceabilityLeadRoles = [
  OrganizationRole.admin,
  OrganizationRole.compliance_lead,
  OrganizationRole.expert
];

const createLotSchema = z.object({
  code: z.string().trim().min(1).max(120),
  farmSiteId: z.string().trim().min(1),
  cropCycleId: z.string().trim().min(1).optional(),
  commodityName: z.string().trim().min(1).max(160),
  varietyName: z.string().trim().min(1).max(160).optional(),
  packHouseName: z.string().trim().min(1).max(200).optional(),
  harvestedAt: z.coerce.date(),
  packedAt: z.coerce.date().optional(),
  status: z.enum(lotStatusValues).optional()
});

const listLotsQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional(),
  cropCycleId: z.string().trim().min(1).optional(),
  status: z.enum(lotStatusValues).optional(),
  code: z.string().trim().min(1).optional()
});

const linkGapRecordSchema = z.object({
  gapRecordId: z.string().trim().min(1),
  linkType: z.enum(lotGapRecordLinkValues)
});

const addLineageSchema = z.object({
  childLotId: z.string().trim().min(1),
  relationshipType: z.enum(lineageRelationshipValues),
  notes: z.string().trim().min(1).max(2000).optional()
});

const createDispatchSchema = z.object({
  code: z.string().trim().min(1).max(120),
  destinationName: z.string().trim().min(1).max(200),
  destinationType: z.enum(dispatchDestinationTypeValues),
  shippedAt: z.coerce.date(),
  status: z.enum(dispatchStatusValues).optional(),
  externalRef: z.record(z.any()).optional(),
  lots: z
    .array(
      z.object({
        lotId: z.string().trim().min(1),
        quantity: z.number().positive(),
        unit: z.string().trim().min(1).max(40)
      })
    )
    .min(1)
    .max(100)
});

const createExerciseSchema = z.object({
  targetLotId: z.string().trim().min(1)
});

const completeExerciseSchema = z.object({
  status: z.enum(exerciseStatusValues).optional(),
  result: z.record(z.any()).optional()
});

const reasonSchema = z.object({
  reason: z.string().trim().min(1).max(2000).optional()
});

const lotSelect: any = {
  id: true,
  organizationId: true,
  farmSiteId: true,
  cropCycleId: true,
  code: true,
  commodityName: true,
  varietyName: true,
  packHouseName: true,
  harvestedAt: true,
  packedAt: true,
  status: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  farmSite: {
    select: {
      id: true,
      name: true,
      code: true
    }
  },
  cropCycle: {
    select: {
      id: true,
      cropName: true,
      startedAt: true,
      endedAt: true
    }
  },
  gapRecordLinks: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      gapRecordId: true,
      linkType: true,
      createdByUserId: true,
      createdAt: true,
      gapRecord: {
        select: {
          id: true,
          title: true,
          status: true,
          recordedAt: true,
          checklist: {
            select: {
              code: true,
              title: true
            }
          }
        }
      }
    }
  },
  parentLineages: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      parentLotId: true,
      childLotId: true,
      relationshipType: true,
      notes: true,
      createdAt: true,
      childLot: {
        select: {
          id: true,
          code: true,
          status: true
        }
      }
    }
  },
  childLineages: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      parentLotId: true,
      childLotId: true,
      relationshipType: true,
      notes: true,
      createdAt: true,
      parentLot: {
        select: {
          id: true,
          code: true,
          status: true
        }
      }
    }
  },
  dispatchLots: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      quantity: true,
      unit: true,
      createdAt: true,
      dispatch: {
        select: {
          id: true,
          code: true,
          destinationName: true,
          destinationType: true,
          shippedAt: true,
          status: true
        }
      }
    }
  }
};

const dispatchSelect: any = {
  id: true,
  organizationId: true,
  code: true,
  destinationName: true,
  destinationType: true,
  shippedAt: true,
  status: true,
  externalRefJson: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  lots: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      lotId: true,
      quantity: true,
      unit: true,
      createdAt: true,
      lot: {
        select: {
          id: true,
          code: true,
          commodityName: true,
          status: true,
          harvestedAt: true
        }
      }
    }
  }
};

export const traceabilityRouter = Router();

traceabilityRouter.use(requireTenantContext);

traceabilityRouter.get("/lots", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = listLotsQuerySchema.parse(req.query);
    const lots = await prisma.traceLot.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(filters.farmSiteId ? { farmSiteId: filters.farmSiteId } : {}),
        ...(filters.cropCycleId ? { cropCycleId: filters.cropCycleId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.code ? { code: { contains: filters.code, mode: "insensitive" } } : {})
      },
      orderBy: [{ harvestedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: lotSelect
    } as any);

    res.json({ items: lots, organizationId: tenant.organizationId, filters });
  } catch (error) {
    next(error);
  }
});

traceabilityRouter.post(
  "/lots",
  requireOrganizationRole(traceabilityWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createLotSchema.parse(req.body);
      const resolution = await resolveLotLocation(tenant.organizationId, payload.farmSiteId, payload.cropCycleId ?? null);
      if (!resolution.ok) {
        return res.status(resolution.status).json({ error: resolution.error });
      }

      const created = await prisma.$transaction(async (tx) => {
        const lot = await tx.traceLot.create({
          data: {
            organizationId: tenant.organizationId,
            farmSiteId: resolution.farmSite.id,
            cropCycleId: resolution.cropCycle?.id ?? null,
            code: payload.code,
            commodityName: payload.commodityName,
            varietyName: payload.varietyName ?? null,
            packHouseName: payload.packHouseName ?? null,
            harvestedAt: payload.harvestedAt,
            packedAt: payload.packedAt ?? null,
            status: payload.status ?? TraceLotStatus.open,
            createdByUserId: tenant.userId
          },
          select: lotSelect
        } as any);

        await writeTraceabilityEvent(tx, {
          organizationId: tenant.organizationId,
          lotId: lot.id,
          actorUserId: tenant.userId,
          eventType: "lot.created",
          payloadJson: {
            code: lot.code,
            farmSiteId: lot.farmSiteId,
            cropCycleId: lot.cropCycleId,
            harvestedAt: lot.harvestedAt.toISOString()
          }
        });
        await writeTraceAudit(tx, tenant, "trace_lot", lot.id, "trace_lot.created", {
          code: lot.code,
          farmSiteId: lot.farmSiteId,
          cropCycleId: lot.cropCycleId
        });

        return lot;
      });

      res.status(201).json({ item: created });
    } catch (error) {
      next(error);
    }
  }
);

traceabilityRouter.get("/lots/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const lot = await findLot(tenant.organizationId, String(req.params.id));
    if (!lot) {
      return res.status(404).json({ error: { code: "trace_lot_not_found", message: "Trace lot was not found in this organization." } });
    }
    res.json({ item: lot });
  } catch (error) {
    next(error);
  }
});

traceabilityRouter.post(
  "/lots/:id/gap-record-links",
  requireOrganizationRole(traceabilityWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const lotId = String(req.params.id);
      const payload = linkGapRecordSchema.parse(req.body);
      const [lot, gapRecord] = await Promise.all([
        prisma.traceLot.findFirst({ where: { id: lotId, organizationId: tenant.organizationId }, select: { id: true, code: true } }),
        prisma.gapRecord.findFirst({
          where: { id: payload.gapRecordId, organizationId: tenant.organizationId },
          select: { id: true, title: true, checklist: { select: { code: true } } }
        } as any)
      ]);
      if (!lot) {
        return res.status(404).json({ error: { code: "trace_lot_not_found", message: "Trace lot was not found in this organization." } });
      }
      if (!gapRecord) {
        return res.status(404).json({ error: { code: "gap_record_not_found", message: "GAP record was not found in this organization." } });
      }
      const controlPointRef = (gapRecord as any).checklist?.code ?? null;

      const item = await prisma.$transaction(async (tx) => {
        const link = await tx.traceLotGapRecord.create({
          data: {
            organizationId: tenant.organizationId,
            lotId: lot.id,
            gapRecordId: gapRecord.id,
            linkType: payload.linkType,
            createdByUserId: tenant.userId
          },
          select: {
            id: true,
            lotId: true,
            gapRecordId: true,
            linkType: true,
            createdByUserId: true,
            createdAt: true
          }
        });
        await writeTraceabilityEvent(tx, {
          organizationId: tenant.organizationId,
          lotId: lot.id,
          actorUserId: tenant.userId,
          eventType: "lot.linked_gap_record",
          payloadJson: {
            gapRecordId: gapRecord.id,
            linkType: payload.linkType,
            controlPointRef
          }
        });
        await writeTraceAudit(tx, tenant, "trace_lot", lot.id, "trace_lot.linked_gap_record", {
          gapRecordId: gapRecord.id,
          linkType: payload.linkType,
          controlPointRef
        });
        return link;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

traceabilityRouter.post(
  "/lots/:id/lineage",
  requireOrganizationRole(traceabilityWriteRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const parentLotId = String(req.params.id);
      const payload = addLineageSchema.parse(req.body);
      if (parentLotId === payload.childLotId) {
        return res.status(400).json({ error: { code: "lineage_self_link", message: "A lot cannot be linked to itself." } });
      }

      const lots = await prisma.traceLot.findMany({
        where: { organizationId: tenant.organizationId, id: { in: [parentLotId, payload.childLotId] } },
        select: { id: true, code: true }
      });
      if (lots.length !== 2) {
        return res.status(404).json({ error: { code: "trace_lot_not_found", message: "Parent and child lots must both exist in this organization." } });
      }

      const item = await prisma.$transaction(async (tx) => {
        const lineage = await tx.traceLotLineage.create({
          data: {
            organizationId: tenant.organizationId,
            parentLotId,
            childLotId: payload.childLotId,
            relationshipType: payload.relationshipType,
            notes: payload.notes ?? null,
            createdByUserId: tenant.userId
          }
        });
        await writeTraceabilityEvent(tx, {
          organizationId: tenant.organizationId,
          lotId: parentLotId,
          actorUserId: tenant.userId,
          eventType: `lot.${payload.relationshipType}`,
          payloadJson: {
            lineageId: lineage.id,
            parentLotId,
            childLotId: payload.childLotId,
            relationshipType: payload.relationshipType
          }
        });
        await writeTraceAudit(tx, tenant, "trace_lot", parentLotId, "trace_lot.lineage_added", {
          lineageId: lineage.id,
          childLotId: payload.childLotId,
          relationshipType: payload.relationshipType
        });
        return lineage;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

traceabilityRouter.post(
  "/lots/:id/hold",
  requireOrganizationRole(traceabilityLeadRoles),
  async (req, res, next) => updateLotStatus(req, res, next, TraceLotStatus.on_hold, "trace_lot.held", "lot.held")
);

traceabilityRouter.post(
  "/lots/:id/release",
  requireOrganizationRole(traceabilityLeadRoles),
  async (req, res, next) => updateLotStatus(req, res, next, TraceLotStatus.released, "trace_lot.released", "lot.released")
);

traceabilityRouter.get("/lots/:id/lineage", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const lot = await prisma.traceLot.findFirst({
      where: { id: String(req.params.id), organizationId: tenant.organizationId },
      select: { id: true, code: true }
    });
    if (!lot) {
      return res.status(404).json({ error: { code: "trace_lot_not_found", message: "Trace lot was not found in this organization." } });
    }
    const report = await buildTraceReport(tenant.organizationId, lot.id);
    res.json({ item: report });
  } catch (error) {
    next(error);
  }
});

traceabilityRouter.get("/lots/:id/events", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const lot = await prisma.traceLot.findFirst({ where: { id: String(req.params.id), organizationId: tenant.organizationId }, select: { id: true } });
    if (!lot) {
      return res.status(404).json({ error: { code: "trace_lot_not_found", message: "Trace lot was not found in this organization." } });
    }
    const events = await prisma.traceabilityEvent.findMany({
      where: { organizationId: tenant.organizationId, lotId: lot.id },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
    });
    res.json({ items: events, lotId: lot.id });
  } catch (error) {
    next(error);
  }
});

traceabilityRouter.post(
  "/dispatches",
  requireOrganizationRole(traceabilityLeadRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createDispatchSchema.parse(req.body);
      const lotIds = [...new Set(payload.lots.map((lot) => lot.lotId))];
      if (lotIds.length !== payload.lots.length) {
        return res.status(400).json({ error: { code: "duplicate_dispatch_lot", message: "Each lot can appear only once per dispatch." } });
      }
      const lots = await prisma.traceLot.findMany({
        where: { organizationId: tenant.organizationId, id: { in: lotIds } },
        select: { id: true, code: true, status: true }
      });
      if (lots.length !== lotIds.length) {
        return res.status(404).json({ error: { code: "trace_lot_not_found", message: "All dispatch lots must exist in this organization." } });
      }

      const item = await prisma.$transaction(async (tx) => {
        const dispatch = await tx.traceDispatch.create({
          data: {
            organizationId: tenant.organizationId,
            code: payload.code,
            destinationName: payload.destinationName,
            destinationType: payload.destinationType,
            shippedAt: payload.shippedAt,
            status: payload.status ?? TraceDispatchStatus.dispatched,
            externalRefJson: payload.externalRef as Prisma.InputJsonValue | undefined,
            createdByUserId: tenant.userId,
            lots: {
              create: payload.lots.map((lot) => ({
                organizationId: tenant.organizationId,
                lotId: lot.lotId,
                quantity: lot.quantity,
                unit: lot.unit
              }))
            }
          },
          select: dispatchSelect
        } as any);

        if (dispatch.status === TraceDispatchStatus.dispatched) {
          await tx.traceLot.updateMany({
            where: { organizationId: tenant.organizationId, id: { in: lotIds }, status: { not: TraceLotStatus.recalled } },
            data: { status: TraceLotStatus.shipped }
          });
        }
        await writeTraceabilityEvent(tx, {
          organizationId: tenant.organizationId,
          dispatchId: dispatch.id,
          actorUserId: tenant.userId,
          eventType: "dispatch.created",
          payloadJson: {
            code: dispatch.code,
            status: dispatch.status,
            lotIds
          }
        });
        await writeTraceAudit(tx, tenant, "trace_dispatch", dispatch.id, "trace_dispatch.created", {
          code: dispatch.code,
          status: dispatch.status,
          lotIds
        });
        return dispatch;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

traceabilityRouter.get("/dispatches/:id", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const dispatch = await prisma.traceDispatch.findFirst({
      where: { id: String(req.params.id), organizationId: tenant.organizationId },
      select: dispatchSelect
    } as any);
    if (!dispatch) {
      return res.status(404).json({ error: { code: "trace_dispatch_not_found", message: "Trace dispatch was not found in this organization." } });
    }
    res.json({ item: dispatch });
  } catch (error) {
    next(error);
  }
});

traceabilityRouter.post(
  "/exercises",
  requireOrganizationRole(traceabilityLeadRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = createExerciseSchema.parse(req.body);
      const lot = await prisma.traceLot.findFirst({
        where: { id: payload.targetLotId, organizationId: tenant.organizationId },
        select: { id: true, code: true }
      });
      if (!lot) {
        return res.status(404).json({ error: { code: "trace_lot_not_found", message: "Target lot was not found in this organization." } });
      }

      const item = await prisma.$transaction(async (tx) => {
        const exercise = await tx.traceabilityExercise.create({
          data: {
            organizationId: tenant.organizationId,
            targetLotId: lot.id,
            initiatedByUserId: tenant.userId,
            status: TraceabilityExerciseStatus.running
          }
        });
        await writeTraceabilityEvent(tx, {
          organizationId: tenant.organizationId,
          lotId: lot.id,
          exerciseId: exercise.id,
          actorUserId: tenant.userId,
          eventType: "exercise.started",
          payloadJson: { targetLotId: lot.id, targetLotCode: lot.code }
        });
        await writeTraceAudit(tx, tenant, "traceability_exercise", exercise.id, "traceability_exercise.started", {
          targetLotId: lot.id,
          targetLotCode: lot.code
        });
        return exercise;
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  }
);

traceabilityRouter.post(
  "/exercises/:id/complete",
  requireOrganizationRole(traceabilityLeadRoles),
  async (req, res, next) => {
    try {
      const tenant = getTenantContext(res);
      const payload = completeExerciseSchema.parse(req.body);
      const exercise = await prisma.traceabilityExercise.findFirst({
        where: { id: String(req.params.id), organizationId: tenant.organizationId },
        select: { id: true, targetLotId: true, status: true }
      });
      if (!exercise) {
        return res.status(404).json({ error: { code: "traceability_exercise_not_found", message: "Traceability exercise was not found in this organization." } });
      }
      if (exercise.status === TraceabilityExerciseStatus.completed || exercise.status === TraceabilityExerciseStatus.failed) {
        return res.status(409).json({ error: { code: "traceability_exercise_closed", message: "Traceability exercise is already closed." } });
      }

      const report = await buildTraceReport(tenant.organizationId, exercise.targetLotId);
      const resultJson = {
        ...report,
        operatorResult: payload.result ?? null
      };
      const nextStatus = payload.status ?? TraceabilityExerciseStatus.completed;
      if (nextStatus !== TraceabilityExerciseStatus.completed && nextStatus !== TraceabilityExerciseStatus.failed) {
        return res.status(400).json({ error: { code: "invalid_exercise_completion_status", message: "Completion status must be completed or failed." } });
      }

      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.traceabilityExercise.update({
          where: { id: exercise.id },
          data: {
            status: nextStatus,
            completedAt: new Date(),
            resultJson: resultJson as Prisma.InputJsonValue
          }
        });
        await writeTraceabilityEvent(tx, {
          organizationId: tenant.organizationId,
          lotId: exercise.targetLotId,
          exerciseId: exercise.id,
          actorUserId: tenant.userId,
          eventType: "exercise.completed",
          payloadJson: {
            status: nextStatus,
            lotCount: report.lots.length,
            dispatchCount: report.dispatches.length
          }
        });
        await writeTraceAudit(tx, tenant, "traceability_exercise", exercise.id, "traceability_exercise.completed", {
          targetLotId: exercise.targetLotId,
          status: nextStatus,
          lotCount: report.lots.length,
          dispatchCount: report.dispatches.length
        });
        return updated;
      });

      res.json({ item });
    } catch (error) {
      next(error);
    }
  }
);

traceabilityRouter.get("/exercises/:id/report", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const exercise = await prisma.traceabilityExercise.findFirst({
      where: { id: String(req.params.id), organizationId: tenant.organizationId }
    });
    if (!exercise) {
      return res.status(404).json({ error: { code: "traceability_exercise_not_found", message: "Traceability exercise was not found in this organization." } });
    }
    const report = exercise.resultJson ?? (await buildTraceReport(tenant.organizationId, exercise.targetLotId));
    res.json({ item: { exercise, report } });
  } catch (error) {
    next(error);
  }
});

async function updateLotStatus(
  req: Parameters<Parameters<typeof traceabilityRouter.post>[1]>[0],
  res: Parameters<Parameters<typeof traceabilityRouter.post>[1]>[1],
  next: Parameters<Parameters<typeof traceabilityRouter.post>[1]>[2],
  nextStatus: TraceLotStatus,
  auditAction: string,
  eventType: string
) {
  try {
    const tenant = getTenantContext(res);
    const payload = reasonSchema.parse(req.body);
    const lot = await prisma.traceLot.findFirst({
      where: { id: String(req.params.id), organizationId: tenant.organizationId },
      select: { id: true, code: true, status: true }
    });
    if (!lot) {
      return res.status(404).json({ error: { code: "trace_lot_not_found", message: "Trace lot was not found in this organization." } });
    }
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.traceLot.update({
        where: { id: lot.id },
        data: { status: nextStatus },
        select: lotSelect
      } as any);
      await writeTraceabilityEvent(tx, {
        organizationId: tenant.organizationId,
        lotId: lot.id,
        actorUserId: tenant.userId,
        eventType,
        payloadJson: {
          previousStatus: lot.status,
          nextStatus,
          reason: payload.reason ?? null
        }
      });
      await writeTraceAudit(tx, tenant, "trace_lot", lot.id, auditAction, {
        previousStatus: lot.status,
        nextStatus,
        reason: payload.reason ?? null
      });
      return updated;
    });
    return res.json({ item });
  } catch (error) {
    return next(error);
  }
}

async function findLot(organizationId: string, lotId: string) {
  return prisma.traceLot.findFirst({
    where: { id: lotId, organizationId },
    select: lotSelect
  } as any);
}

async function resolveLotLocation(organizationId: string, farmSiteId: string, cropCycleId: string | null) {
  const farmSite = await prisma.farmSite.findFirst({
    where: { id: farmSiteId, organizationId },
    select: { id: true, name: true }
  });
  if (!farmSite) {
    return {
      ok: false as const,
      status: 404,
      error: { code: "farm_site_not_found", message: "Farm site was not found in this organization." }
    };
  }
  const cropCycle = cropCycleId
    ? await prisma.cropCycle.findFirst({
        where: { id: cropCycleId, organizationId },
        select: { id: true, farmSiteId: true, cropName: true }
      })
    : null;
  if (cropCycleId && !cropCycle) {
    return {
      ok: false as const,
      status: 404,
      error: { code: "crop_cycle_not_found", message: "Crop cycle was not found in this organization." }
    };
  }
  if (cropCycle && cropCycle.farmSiteId !== farmSite.id) {
    return {
      ok: false as const,
      status: 409,
      error: { code: "trace_lot_context_conflict", message: "Crop cycle does not belong to the selected farm site." }
    };
  }
  return { ok: true as const, farmSite, cropCycle };
}

async function buildTraceReport(organizationId: string, targetLotId: string) {
  const lots = await prisma.traceLot.findMany({
    where: { organizationId },
    select: {
      id: true,
      code: true,
      status: true,
      commodityName: true,
      harvestedAt: true,
      farmSiteId: true,
      cropCycleId: true
    }
  });
  const lineages = await prisma.traceLotLineage.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const lotMap = new Map(lots.map((lot) => [lot.id, lot]));
  if (!lotMap.has(targetLotId)) {
    return { targetLotId, lots: [], lineages: [], gapRecordLinks: [], dispatches: [] };
  }

  const reachable = new Set<string>([targetLotId]);
  let changed = true;
  while (changed && reachable.size < 500) {
    changed = false;
    for (const edge of lineages) {
      if (reachable.has(edge.parentLotId) && !reachable.has(edge.childLotId)) {
        reachable.add(edge.childLotId);
        changed = true;
      }
      if (reachable.has(edge.childLotId) && !reachable.has(edge.parentLotId)) {
        reachable.add(edge.parentLotId);
        changed = true;
      }
    }
  }

  const lotIds = [...reachable];
  const [gapRecordLinks, dispatchLots] = await Promise.all([
    prisma.traceLotGapRecord.findMany({
      where: { organizationId, lotId: { in: lotIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        lotId: true,
        gapRecordId: true,
        linkType: true,
        gapRecord: {
          select: {
            id: true,
            title: true,
            status: true,
            checklist: { select: { code: true } }
          }
        }
      }
    } as any),
    prisma.traceDispatchLot.findMany({
      where: { organizationId, lotId: { in: lotIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        lotId: true,
        quantity: true,
        unit: true,
        dispatch: {
          select: {
            id: true,
            code: true,
            destinationName: true,
            destinationType: true,
            shippedAt: true,
            status: true
          }
        }
      }
    } as any)
  ]);

  return {
    targetLotId,
    generatedAt: new Date().toISOString(),
    lots: lotIds.map((id) => lotMap.get(id)).filter(Boolean),
    lineages: lineages.filter((edge) => reachable.has(edge.parentLotId) && reachable.has(edge.childLotId)),
    gapRecordLinks,
    dispatches: dispatchLots
  };
}

async function writeTraceabilityEvent(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    lotId?: string;
    dispatchId?: string;
    exerciseId?: string;
    actorUserId?: string;
    eventType: string;
    payloadJson?: Prisma.InputJsonValue;
  }
) {
  await tx.traceabilityEvent.create({
    data: {
      organizationId: input.organizationId,
      lotId: input.lotId ?? null,
      dispatchId: input.dispatchId ?? null,
      exerciseId: input.exerciseId ?? null,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      occurredAt: new Date(),
      payloadJson: input.payloadJson
    }
  });
}

async function writeTraceAudit(
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
