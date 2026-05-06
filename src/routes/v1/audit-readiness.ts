import { createHash } from "node:crypto";
import express, { Router } from "express";
import {
  CorrectiveActionStatus,
  EvidenceReviewStatus,
  GapRecordStatus,
  OrganizationRole,
  Prisma,
  ReviewThreadStatus
} from "@prisma/client";
import { z } from "zod";
import {
  getTenantContext,
  requireOrganizationRole,
  requireTenantContext
} from "../../auth/tenant-context.js";
import { prisma } from "../../lib/prisma.js";
import {
  resolveGapRecordCurrentReadinessStatus,
  resolveGapRecordCurrentReviewState
} from "./gap-record-workflow.js";
import { isWorkflowActiveEvidence, resolveThreadStatus } from "./review-threads.js";

const RULESET_NAME = "USDA H-GAP";
const RULESET_VERSION = "control-point-ref-v1";

const dashboardQuerySchema = z.object({
  farmSiteId: z.string().trim().min(1).optional()
});

const gapRecordStatusValues = Object.values(GapRecordStatus) as [GapRecordStatus, ...GapRecordStatus[]];
const reviewThreadStatusValues = Object.values(ReviewThreadStatus) as [
  ReviewThreadStatus,
  ...ReviewThreadStatus[]
];
const evidenceReviewStatusValues = Object.values(EvidenceReviewStatus) as [
  EvidenceReviewStatus,
  ...EvidenceReviewStatus[]
];
const correctiveActionStatusValues = Object.values(CorrectiveActionStatus) as [
  CorrectiveActionStatus,
  ...CorrectiveActionStatus[]
];

const auditReadinessGapRecordSelect: any = {
  id: true,
  organizationId: true,
  title: true,
  notes: true,
  status: true,
  reviewThreadStatus: true,
  currentVersionId: true,
  recordedAt: true,
  createdAt: true,
  updatedAt: true,
  checklist: {
    select: {
      id: true,
      code: true,
      title: true,
      description: true
    }
  },
  cropCycle: {
    select: {
      id: true,
      cropName: true,
      startedAt: true,
      endedAt: true,
      farmSite: {
        select: {
          id: true,
          name: true,
          code: true
        }
      },
      plot: {
        select: {
          id: true,
          name: true,
          areaRai: true
        }
      }
    }
  },
  evidences: {
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      gapRecordVersionId: true,
      controlPointRef: true,
      kind: true,
      storageKey: true,
      fileName: true,
      contentType: true,
      fileSize: true,
      capturedAt: true,
      noteText: true,
      documentId: true,
      supersededAt: true,
      supersededByEvidenceId: true,
      submittedByUserId: true,
      submittedAt: true,
      reviewStatus: true,
      lastReviewedByUserId: true,
      lastReviewedAt: true,
      createdAt: true,
      document: {
        select: {
          id: true,
          status: true,
          fileName: true,
          contentType: true,
          blobSize: true,
          blobSha256: true,
          storageKey: true,
          finalizedAt: true
        }
      },
      reviews: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewerUserId: true,
          createdAt: true
        }
      }
    }
  },
  currentVersion: {
    select: {
      id: true,
      versionNumber: true,
      titleSnapshot: true,
      notesSnapshot: true,
      recordedAt: true,
      createdAt: true,
      reviews: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewerUserId: true,
          createdAt: true
        }
      }
    }
  },
  versions: {
    orderBy: [{ versionNumber: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      versionNumber: true,
      reviews: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          decision: true,
          comment: true,
          reviewerUserId: true,
          createdAt: true
        }
      }
    }
  },
  comments: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      authorUserId: true,
      body: true,
      createdAt: true
    }
  },
  correctiveActions: {
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
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
      evidenceLinks: {
        orderBy: [{ createdAt: "asc" }, { evidenceId: "asc" }],
        select: {
          evidenceId: true,
          createdAt: true
        }
      }
    }
  }
};

type AuditReadinessGapRecord = any;

type IdentityMap = Map<
  string,
  {
    name: string;
    role: string | null;
  }
>;

export const auditReadinessRouter = Router();

auditReadinessRouter.use(express.json());
auditReadinessRouter.use(requireTenantContext);
auditReadinessRouter.use(
  requireOrganizationRole([
    OrganizationRole.admin,
    OrganizationRole.compliance_lead,
    OrganizationRole.expert
  ])
);

auditReadinessRouter.get("/dashboard", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = dashboardQuerySchema.parse(req.query);
    const snapshot = await buildAuditReadinessSnapshot(tenant.organizationId, filters.farmSiteId);

    res.json(snapshot.dashboard);
  } catch (error) {
    next(error);
  }
});

auditReadinessRouter.get("/packet-export", async (req, res, next) => {
  try {
    const tenant = getTenantContext(res);
    const filters = dashboardQuerySchema.parse(req.query);
    const snapshot = await buildAuditReadinessSnapshot(tenant.organizationId, filters.farmSiteId);
    const exportPayload = {
      ...snapshot.exportPacket,
      generatedByUserId: tenant.userId
    };
    const canonicalJson = JSON.stringify(exportPayload);
    const canonicalJsonSha256 = createHash("sha256").update(canonicalJson).digest("hex");

    const finalPayload = {
      ...exportPayload,
      reproducibility: {
        ...exportPayload.reproducibility,
        canonicalJsonSha256
      }
    };

    const fileName = buildPacketFileName(snapshot.dashboard.organization.name, filters.farmSiteId);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename=\"${fileName}\"`);
    res.json(finalPayload);
  } catch (error) {
    next(error);
  }
});

async function buildAuditReadinessSnapshot(organizationId: string, farmSiteId?: string) {
  const where: Prisma.GapRecordWhereInput = {
    organizationId,
    ...(farmSiteId
      ? {
          cropCycle: {
            farmSiteId
          }
        }
      : {})
  };

  const [organization, rawRecords, auditEvents] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: {
        id: organizationId
      },
      select: {
        id: true,
        name: true,
        description: true
      }
    }),
    prisma.gapRecord.findMany({
      where,
      orderBy: [
        { checklist: { code: "asc" } },
        { title: "asc" },
        { createdAt: "asc" },
        { id: "asc" }
      ],
      select: auditReadinessGapRecordSelect
    } as any),
    prisma.auditEvent.findMany({
      where: {
        organizationId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        actorUserId: true,
        entityType: true,
        entityId: true,
        action: true,
        payloadJson: true,
        createdAt: true
      }
    })
  ]);
  const records = rawRecords as AuditReadinessGapRecord[];

  const identities = await loadIdentityMap(organizationId, collectIdentityUserIds(records, auditEvents));
  const filteredAuditEvents = filterAuditEventsByFarmSite(records, auditEvents, farmSiteId);
  const sectionSummaries = buildSectionSummaries(records, identities);
  const openCorrectiveActions = records
    .flatMap((record: any) => record.correctiveActions.map((action: any) => serializeCorrectiveAction(record, action, identities)))
    .filter((action: any) => action.status !== CorrectiveActionStatus.closed)
    .sort(compareCorrectiveActions);
  const closedCorrectiveActions = records
    .flatMap((record: any) => record.correctiveActions.map((action: any) => serializeCorrectiveAction(record, action, identities)))
    .filter((action: any) => action.status === CorrectiveActionStatus.closed)
    .sort(compareCorrectiveActions);

  const summary = buildSummary(records, openCorrectiveActions);
  const recentActivity = filteredAuditEvents
    .slice(0, 25)
    .map((event) => serializeAuditEvent(event, identities));
  const evidenceManifest = buildEvidenceManifest(records, identities);
  const reviewHistory = buildReviewHistory(records, identities);
  const detailedGapRecords = buildDetailedGapRecords(records, identities);

  return {
    dashboard: {
      organizationId,
      organization,
      filter: {
        farmSiteId: farmSiteId ?? null
      },
      ruleset: {
        name: RULESET_NAME,
        version: RULESET_VERSION
      },
      generatedAt: new Date().toISOString(),
      summary,
      sections: sectionSummaries,
      openCorrectiveActions,
      recentActivity
    },
    exportPacket: {
      schemaVersion: "smartfarm.audit-packet.v1",
      organization,
      filter: {
        farmSiteId: farmSiteId ?? null
      },
      ruleset: {
        name: RULESET_NAME,
        version: RULESET_VERSION
      },
      generatedAt: new Date().toISOString(),
      readinessSummary: summary,
      sections: sectionSummaries,
      gapRecords: detailedGapRecords,
      evidenceManifest,
      reviewHistory,
      correctiveActions: {
        open: openCorrectiveActions,
        closed: closedCorrectiveActions
      },
      auditLog: filteredAuditEvents
        .slice()
        .reverse()
        .map((event) => serializeAuditEvent(event, identities)),
      reproducibility: {
        canonicalJsonSha256: null,
        packetFormat: "json-equivalent",
        notes: "This API slice emits the canonical JSON packet. PDF/ZIP packaging can layer on top without changing the manifest."
      }
    }
  };
}

function buildSummary(records: AuditReadinessGapRecord[], openCorrectiveActions: ReturnType<typeof serializeCorrectiveAction>[]) {
  const gapRecordStatusCounts = createCountMap(gapRecordStatusValues);
  const reviewThreadStatusCounts = createCountMap(reviewThreadStatusValues);
  const evidenceReviewStatusCounts = createCountMap(evidenceReviewStatusValues);
  const correctiveActionStatusCounts = createCountMap(correctiveActionStatusValues);
  let totalApprovedRecords = 0;
  let totalEvidence = 0;

  for (const record of records) {
    const resolvedReviewThreadStatus = getResolvedReviewThreadStatus(record);
    const activeEvidences = getActiveWorkflowEvidence(record);
    const currentReadinessStatus = getCurrentReadinessStatus(record);
    gapRecordStatusCounts[record.status] += 1;
    reviewThreadStatusCounts[resolvedReviewThreadStatus] += 1;
    if (currentReadinessStatus === "ready") {
      totalApprovedRecords += 1;
    }

    for (const evidence of activeEvidences) {
      evidenceReviewStatusCounts[evidence.reviewStatus] += 1;
    }

    for (const evidence of record.evidences) {
      totalEvidence += 1;
    }

    for (const action of record.correctiveActions) {
      correctiveActionStatusCounts[action.status] += 1;
    }
  }

  const overdueCorrectiveActions = openCorrectiveActions.filter((action) => action.isOverdue).length;
  const needsReviewLaneCount =
    evidenceReviewStatusCounts[EvidenceReviewStatus.pending_review] +
    correctiveActionStatusCounts[CorrectiveActionStatus.submitted_for_review];

  return {
    totalGapRecords: records.length,
    totalEvidence,
    readinessScore:
      records.length === 0 ? 0 : Math.round((totalApprovedRecords / records.length) * 100),
    gapRecordStatusCounts,
    reviewThreadStatusCounts,
    evidenceReviewStatusCounts,
    correctiveActionStatusCounts,
    openCorrectiveActions: openCorrectiveActions.length,
    overdueCorrectiveActions,
    needsReviewLaneCount
  };
}

function buildSectionSummaries(records: AuditReadinessGapRecord[], identities: IdentityMap) {
  const sections = new Map<string, any>();

  for (const record of records) {
    const resolvedReviewThreadStatus = getResolvedReviewThreadStatus(record);
    const currentReadinessStatus = getCurrentReadinessStatus(record);
    const key = deriveSectionKey(record.checklist?.code);
    const entry =
      sections.get(key) ??
      {
        key,
        title: record.checklist?.title ?? null,
        gapRecordStatusCounts: createCountMap(gapRecordStatusValues),
        reviewThreadStatusCounts: createCountMap(reviewThreadStatusValues),
        evidenceReviewStatusCounts: createCountMap(evidenceReviewStatusValues),
        correctiveActionStatusCounts: createCountMap(correctiveActionStatusValues),
        overdueCorrectiveActions: 0,
        records: [] as any[],
        ownerCounts: new Map<string, any>()
      };

    entry.gapRecordStatusCounts[record.status] += 1;
    entry.reviewThreadStatusCounts[resolvedReviewThreadStatus] += 1;

    for (const evidence of getActiveWorkflowEvidence(record)) {
      entry.evidenceReviewStatusCounts[evidence.reviewStatus] += 1;
    }

    let openCorrectiveActions = 0;
    for (const action of record.correctiveActions) {
      entry.correctiveActionStatusCounts[action.status] += 1;

      if (action.status !== CorrectiveActionStatus.closed) {
        openCorrectiveActions += 1;
        if (isOverdue(action.dueAt, action.status)) {
          entry.overdueCorrectiveActions += 1;
        }
        if (action.ownerUserId) {
          const ownerCount = entry.ownerCounts.get(action.ownerUserId) ?? {
            userId: action.ownerUserId,
            count: 0
          };
          ownerCount.count += 1;
          entry.ownerCounts.set(action.ownerUserId, ownerCount);
        }
      }
    }

    entry.records.push({
      id: record.id,
      title: record.title,
      status: record.status,
      reviewThreadStatus: resolvedReviewThreadStatus,
      currentReadinessStatus,
      farmSiteName: record.cropCycle?.farmSite.name ?? null,
      openCorrectiveActions
    });

    sections.set(key, entry);
  }

  return [...sections.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((section) => ({
      key: section.key,
      title: section.title,
      readinessScore:
        section.records.length === 0
          ? 0
          : Math.round(
              (section.records.filter((record: any) => record.currentReadinessStatus === "ready").length /
                section.records.length) *
                100
            ),
      gapRecordStatusCounts: section.gapRecordStatusCounts,
      reviewThreadStatusCounts: section.reviewThreadStatusCounts,
      evidenceReviewStatusCounts: section.evidenceReviewStatusCounts,
      correctiveActionStatusCounts: section.correctiveActionStatusCounts,
      overdueCorrectiveActions: section.overdueCorrectiveActions,
      ownerSummary: [...section.ownerCounts.values()]
        .sort((left, right) => right.count - left.count || left.userId.localeCompare(right.userId))
        .map((owner) => {
          const identity = identities.get(owner.userId);
          return {
            userId: owner.userId,
            name: identity?.name ?? owner.userId,
            role: identity?.role ?? null,
            count: owner.count
          };
        }),
      records: section.records
    }));
}

function buildDetailedGapRecords(records: AuditReadinessGapRecord[], identities: IdentityMap) {
  return records.map((record) => {
    const controlPointRef = record.checklist?.code ?? null;
    return {
      id: record.id,
      title: record.title,
      notes: record.notes,
      status: record.status,
      reviewThreadStatus: getResolvedReviewThreadStatus(record),
      currentReadinessStatus: getCurrentReadinessStatus(record),
      currentReviewState: getCurrentReviewState(record),
      controlPointRef,
      controlPointSection: deriveSectionKey(controlPointRef),
      controlPointCatalog: record.checklist
        ? {
            id: record.checklist.id,
            code: record.checklist.code,
            title: record.checklist.title,
            description: record.checklist.description
          }
        : null,
      recordedAt: record.recordedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      cropCycle: record.cropCycle
        ? {
            id: record.cropCycle.id,
            cropName: record.cropCycle.cropName,
            startedAt: record.cropCycle.startedAt,
            endedAt: record.cropCycle.endedAt,
            farmSite: record.cropCycle.farmSite,
            plot: record.cropCycle.plot
          }
        : null,
      currentVersion: record.currentVersion
        ? {
            id: record.currentVersion.id,
            versionNumber: record.currentVersion.versionNumber,
            titleSnapshot: record.currentVersion.titleSnapshot,
            notesSnapshot: record.currentVersion.notesSnapshot,
            recordedAt: record.currentVersion.recordedAt,
            createdAt: record.currentVersion.createdAt
          }
        : null,
      evidences: record.evidences.map((evidence: any) => serializeEvidence(record, evidence, identities)),
      threadComments: record.comments.map((comment: any) => {
        const identity = identities.get(comment.authorUserId);
        return {
          id: comment.id,
          source: "thread_comment",
          body: comment.body,
          createdAt: comment.createdAt,
          authorUserId: comment.authorUserId,
          authorName: identity?.name ?? comment.authorUserId,
          authorRole: identity?.role ?? null
        };
      }),
      correctiveActions: record.correctiveActions
        .map((action: any) => serializeCorrectiveAction(record, action, identities))
        .sort(compareCorrectiveActions)
    };
  });
}

function buildEvidenceManifest(records: AuditReadinessGapRecord[], identities: IdentityMap) {
  return records
    .flatMap((record: any) =>
      record.evidences.map((evidence: any) => serializeEvidence(record, evidence, identities))
    )
    .sort((left, right) => {
      const submittedAtLeft = left.submittedAt ?? left.createdAt;
      const submittedAtRight = right.submittedAt ?? right.createdAt;
      return (
        new Date(submittedAtLeft).getTime() - new Date(submittedAtRight).getTime() ||
        left.id.localeCompare(right.id)
      );
    });
}

function buildReviewHistory(records: AuditReadinessGapRecord[], identities: IdentityMap) {
  return records
    .flatMap((record: any) => [
      ...record.comments.map((comment: any) => {
        const identity = identities.get(comment.authorUserId);
        return {
          id: comment.id,
          gapRecordId: record.id,
          controlPointRef: record.checklist?.code ?? null,
          source: "thread_comment",
          body: comment.body,
          createdAt: comment.createdAt,
          authorUserId: comment.authorUserId,
          authorName: identity?.name ?? comment.authorUserId,
          authorRole: identity?.role ?? null
        };
      }),
      ...record.evidences.flatMap((evidence: any) =>
        evidence.reviews.map((review: any) => {
          const identity = identities.get(review.reviewerUserId);
          return {
            id: review.id,
            gapRecordId: record.id,
            evidenceId: evidence.id,
            controlPointRef: evidence.controlPointRef ?? record.checklist?.code ?? null,
            source: "evidence_review",
            decision: review.decision,
            body: review.comment,
            createdAt: review.createdAt,
            authorUserId: review.reviewerUserId,
            authorName: identity?.name ?? review.reviewerUserId,
            authorRole: identity?.role ?? null
          };
        })
      ),
      ...record.versions.flatMap((version: any) =>
        version.reviews.map((review: any) => {
          const identity = identities.get(review.reviewerUserId);
          return {
            id: review.id,
            gapRecordId: record.id,
            gapRecordVersionId: version.id,
            gapRecordVersionNumber: version.versionNumber,
            controlPointRef: record.checklist?.code ?? null,
            source: "record_review",
            decision: review.decision,
            body: review.comment,
            createdAt: review.createdAt,
            authorUserId: review.reviewerUserId,
            authorName: identity?.name ?? review.reviewerUserId,
            authorRole: identity?.role ?? null
          };
        })
      )
    ])
    .sort((left, right) => {
      const timeDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return timeDiff !== 0 ? timeDiff : left.id.localeCompare(right.id);
    });
}

function serializeCorrectiveAction(
  record: AuditReadinessGapRecord,
  action: AuditReadinessGapRecord["correctiveActions"][number],
  identities: IdentityMap
) {
  const ownerIdentity = action.ownerUserId ? identities.get(action.ownerUserId) : null;
  const creatorIdentity = identities.get(action.createdByUserId);
  return {
    id: action.id,
    gapRecordId: record.id,
    gapRecordTitle: record.title,
    controlPointRef: action.controlPointRef ?? record.checklist?.code ?? null,
    status: action.status,
    title: action.title,
    details: action.details,
    ownerUserId: action.ownerUserId,
    ownerName: ownerIdentity?.name ?? action.ownerUserId ?? null,
    ownerRole: ownerIdentity?.role ?? null,
    createdByUserId: action.createdByUserId,
    createdByName: creatorIdentity?.name ?? action.createdByUserId,
    createdByRole: creatorIdentity?.role ?? null,
    dueAt: action.dueAt,
    isOverdue: isOverdue(action.dueAt, action.status),
    assignedAt: action.assignedAt,
    submittedForReviewAt: action.submittedForReviewAt,
    verifiedAt: action.verifiedAt,
    closedAt: action.closedAt,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    evidenceIds: action.evidenceLinks.map((link: any) => link.evidenceId)
  };
}

function serializeEvidence(
  record: AuditReadinessGapRecord,
  evidence: AuditReadinessGapRecord["evidences"][number],
  identities: IdentityMap
) {
  const submitterIdentity = evidence.submittedByUserId
    ? identities.get(evidence.submittedByUserId)
    : null;
  const reviewerIdentity = evidence.lastReviewedByUserId
    ? identities.get(evidence.lastReviewedByUserId)
    : null;

  return {
    id: evidence.id,
    gapRecordId: record.id,
    gapRecordVersionId: evidence.gapRecordVersionId,
    gapRecordTitle: record.title,
    controlPointRef: evidence.controlPointRef ?? record.checklist?.code ?? null,
    controlPointSection: deriveSectionKey(evidence.controlPointRef ?? record.checklist?.code),
    kind: evidence.kind,
    storageKey: evidence.storageKey,
    fileName: evidence.fileName,
    contentType: evidence.contentType,
    fileSize: evidence.fileSize,
    capturedAt: evidence.capturedAt,
    noteText: evidence.noteText,
    documentId: evidence.documentId,
    submittedByUserId: evidence.submittedByUserId,
    submittedByName: submitterIdentity?.name ?? evidence.submittedByUserId ?? null,
    submittedByRole: submitterIdentity?.role ?? null,
    submittedAt: evidence.submittedAt,
    reviewStatus: evidence.reviewStatus,
    supersededAt: evidence.supersededAt,
    supersededByEvidenceId: evidence.supersededByEvidenceId,
    isActive: evidence.supersededByEvidenceId == null,
    lastReviewedByUserId: evidence.lastReviewedByUserId,
    lastReviewedByName: reviewerIdentity?.name ?? evidence.lastReviewedByUserId ?? null,
    lastReviewedByRole: reviewerIdentity?.role ?? null,
    lastReviewedAt: evidence.lastReviewedAt,
    createdAt: evidence.createdAt,
    document: evidence.document,
    reviews: evidence.reviews.map((review: any) => {
      const identity = identities.get(review.reviewerUserId);
      return {
        id: review.id,
        decision: review.decision,
        comment: review.comment,
        reviewerUserId: review.reviewerUserId,
        reviewerName: identity?.name ?? review.reviewerUserId,
        reviewerRole: identity?.role ?? null,
        createdAt: review.createdAt
      };
    })
  };
}

function serializeAuditEvent(
  event: {
    id: string;
    actorUserId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    payloadJson: Prisma.JsonValue | null;
    createdAt: Date;
  },
  identities: IdentityMap
) {
  const actorIdentity = event.actorUserId ? identities.get(event.actorUserId) : null;

  return {
    id: event.id,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    actorUserId: event.actorUserId,
    actorName: actorIdentity?.name ?? event.actorUserId ?? null,
    actorRole: actorIdentity?.role ?? null,
    payloadJson: event.payloadJson,
    createdAt: event.createdAt
  };
}

function filterAuditEventsByFarmSite(
  records: AuditReadinessGapRecord[],
  auditEvents: Array<{
    id: string;
    actorUserId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    payloadJson: Prisma.JsonValue | null;
    createdAt: Date;
  }>,
  farmSiteId?: string
) {
  if (!farmSiteId) {
    return auditEvents;
  }

  const gapRecordIds = new Set(records.map((record) => record.id));
  const evidenceIds = new Set(records.flatMap((record: any) => record.evidences.map((evidence: any) => evidence.id)));
  const correctiveActionIds = new Set(
    records.flatMap((record: any) => record.correctiveActions.map((action: any) => action.id))
  );

  return auditEvents.filter((event) => {
    if (event.entityType === "gap_record") {
      return gapRecordIds.has(event.entityId);
    }
    if (event.entityType === "evidence") {
      return evidenceIds.has(event.entityId);
    }
    if (event.entityType === "corrective_action") {
      return correctiveActionIds.has(event.entityId);
    }

    const payload = isJsonObject(event.payloadJson) ? event.payloadJson : null;
    if (!payload) {
      return false;
    }

    return (
      typeof payload.gapRecordId === "string" &&
      gapRecordIds.has(payload.gapRecordId)
    );
  });
}

function collectIdentityUserIds(
  records: AuditReadinessGapRecord[],
  auditEvents: Array<{ actorUserId: string | null }>
) {
  const ids = new Set<string>();

  for (const record of records) {
    for (const comment of record.comments) {
      ids.add(comment.authorUserId);
    }

    for (const evidence of record.evidences) {
      if (evidence.submittedByUserId) {
        ids.add(evidence.submittedByUserId);
      }
      if (evidence.lastReviewedByUserId) {
        ids.add(evidence.lastReviewedByUserId);
      }
      for (const review of evidence.reviews) {
        ids.add(review.reviewerUserId);
      }
    }

    for (const version of record.versions) {
      for (const review of version.reviews) {
        ids.add(review.reviewerUserId);
      }
    }

    for (const action of record.correctiveActions) {
      ids.add(action.createdByUserId);
      if (action.ownerUserId) {
        ids.add(action.ownerUserId);
      }
    }
  }

  for (const event of auditEvents) {
    if (event.actorUserId) {
      ids.add(event.actorUserId);
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

function deriveSectionKey(controlPointRef: string | null | undefined) {
  if (!controlPointRef) {
    return "unmapped";
  }

  const trimmed = controlPointRef.trim();
  if (!trimmed) {
    return "unmapped";
  }

  const [section] = trimmed.split(".");
  return section || trimmed;
}

function createCountMap<T extends string>(values: readonly T[]) {
  return values.reduce<any>((acc, value) => {
    acc[value] = 0;
    return acc;
  }, {});
}

function isOverdue(dueAt: Date, status: CorrectiveActionStatus) {
  return status !== CorrectiveActionStatus.closed && new Date(dueAt).getTime() < Date.now();
}

function compareCorrectiveActions(
  left: ReturnType<typeof serializeCorrectiveAction>,
  right: ReturnType<typeof serializeCorrectiveAction>
) {
  return (
    new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() ||
    left.id.localeCompare(right.id)
  );
}

function isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getActiveWorkflowEvidence(record: AuditReadinessGapRecord) {
  const currentVersionId = record.currentVersion?.id ?? null;
  return record.evidences.filter(
    (evidence: any) => evidence.gapRecordVersionId === currentVersionId && isWorkflowActiveEvidence(evidence)
  );
}

function getResolvedReviewThreadStatus(record: AuditReadinessGapRecord) {
  return resolveThreadStatus(
    record.reviewThreadStatus,
    getActiveWorkflowEvidence(record).map((evidence: any) => evidence.reviewStatus)
  );
}

function getCurrentReviewState(record: AuditReadinessGapRecord) {
  return resolveGapRecordCurrentReviewState(
    record.currentVersion?.reviews ?? [],
    getActiveWorkflowEvidence(record).map((evidence: any) => evidence.reviewStatus)
  );
}

function getCurrentReadinessStatus(record: AuditReadinessGapRecord) {
  return resolveGapRecordCurrentReadinessStatus(
    getCurrentReviewState(record),
    getActiveWorkflowEvidence(record).map((evidence: any) => evidence.reviewStatus)
  );
}

function buildPacketFileName(organizationName: string, farmSiteId?: string) {
  const safeOrgName = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const suffix = farmSiteId ? `-${farmSiteId}` : "";
  return `audit-packet-${safeOrgName || "organization"}${suffix}.json`;
}
