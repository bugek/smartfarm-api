import { prisma } from "./prisma.js";

export const complianceSectionSummarySelect: any = {
  id: true,
  code: true,
  title: true,
  sequence: true
};

export const complianceControlPointSummarySelect: any = {
  id: true,
  code: true,
  title: true,
  sequence: true,
  sectionVersionId: true,
  sectionVersion: {
    select: complianceSectionSummarySelect
  }
};

type ComplianceBindingResult =
  | {
      kind: "gap_record_not_found";
    }
  | {
      kind: "control_point_mismatch";
      expectedControlPointRef: string;
      receivedControlPointRef: string;
    }
  | {
      kind: "compliance_control_binding_missing";
      lookupControlPointRef: string | null;
    }
  | {
      kind: "ok";
      gapRecordId: string;
      controlPointRef: string;
      complianceControlPointVersionId: string;
      complianceSectionVersionId: string;
      complianceControlPoint: any;
    };

export async function resolveEvidenceComplianceBinding(input: {
  organizationId: string;
  gapRecordId: string;
  controlPointRef?: string | null;
}): Promise<ComplianceBindingResult> {
  const gapRecord = await prisma.gapRecord.findFirst({
    where: { id: input.gapRecordId, organizationId: input.organizationId },
    select: {
      id: true,
      checklistId: true,
      checklist: {
        select: {
          code: true
        }
      }
    }
  });

  if (!gapRecord) {
    return { kind: "gap_record_not_found" };
  }

  const requestedControlPointRef = input.controlPointRef?.trim() || null;
  const gapRecordControlPointRef = gapRecord.checklist?.code?.trim() || null;

  if (
    requestedControlPointRef &&
    gapRecordControlPointRef &&
    requestedControlPointRef !== gapRecordControlPointRef
  ) {
    return {
      kind: "control_point_mismatch",
      expectedControlPointRef: gapRecordControlPointRef,
      receivedControlPointRef: requestedControlPointRef
    };
  }

  const lookupControlPointRef = gapRecordControlPointRef ?? requestedControlPointRef;

  const complianceControlPoint = gapRecord.checklistId
    ? await (prisma as any).complianceControlPointVersion.findFirst({
        where: { legacyChecklistId: gapRecord.checklistId },
        select: complianceControlPointSummarySelect
      })
    : lookupControlPointRef
      ? await (prisma as any).complianceControlPointVersion.findFirst({
          where: { code: lookupControlPointRef },
          select: complianceControlPointSummarySelect
        })
      : null;

  if (!complianceControlPoint || !complianceControlPoint.sectionVersionId) {
    return {
      kind: "compliance_control_binding_missing",
      lookupControlPointRef
    };
  }

  return {
    kind: "ok",
    gapRecordId: gapRecord.id,
    controlPointRef: complianceControlPoint.code,
    complianceControlPointVersionId: complianceControlPoint.id,
    complianceSectionVersionId: complianceControlPoint.sectionVersionId,
    complianceControlPoint
  };
}
