import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type AuditInput = {
  organizationId: string;
  actorUserId?: string;
  entityType: string;
  entityId: string;
  action: string;
  payloadJson?: Prisma.InputJsonValue;
};

export async function writeAuditEvent(input: AuditInput) {
  return prisma.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payloadJson: input.payloadJson
    }
  });
}
