import "server-only";
import { HoldKind, HoldOrigin, IncidentSeverity, IncidentStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { resolveEffectiveAt } from "@/lib/lab-time";
import {
  assertCanEditExperiment,
  assertCanEditUnit,
  assertCanManageIncidents,
  assertCanRecordQuality,
  assertCanReleaseHold,
} from "@/server/authz";
import { buildChanges, recordAudit, type RequestMeta } from "@/server/audit";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import {
  assertActive,
  isOnHold,
  lockUnit,
  type LoadedUnit,
  type Tx,
} from "@/features/unit/state-engine";
import type {
  OpenIncidentInput,
  PlaceHoldInput,
  RecordLabTestInput,
  ReleaseHoldInput,
  UpdateIncidentInput,
  VoidRecordInput,
} from "./schemas";
import { isQuality } from "@/lib/roles";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";

/**
 * Quality commands: holds, lab tests and incidents. A hold freezes movement of the unit; it never
 * blocks recording tests, incidents or notes, nor its own release.
 */
const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

type Actor = SessionUser;

async function createHold(
  tx: Tx,
  actor: Actor,
  meta: RequestMeta | undefined,
  unit: Pick<LoadedUnit, "id" | "name">,
  hold: { kind: HoldKind; reason: string; origin: HoldOrigin }
) {
  const created = await tx.unitHold.create({
    data: {
      unitId: unit.id,
      kind: hold.kind,
      reason: hold.reason,
      origin: hold.origin,
      placedById: actor.id,
    },
  });
  await recordAudit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "hold",
    summary:
      hold.origin === HoldOrigin.MANUAL
        ? `Placed on quality hold: ${hold.reason}`
        : `Placed on automatic quality hold: ${hold.reason}`,
    reason: hold.reason,
    changes: [{ field: "hold", from: null, to: hold.kind }],
  });
  return created;
}

export async function placeHold(
  actor: Actor,
  unitId: number,
  input: PlaceHoldInput,
  meta?: RequestMeta
) {
  return prisma.$transaction((tx) => placeHoldTx(tx, actor, unitId, input, meta), TRANSACTION);
}

/** Same as placeHold, inside a caller-owned transaction (so several units commit together). */
export async function placeHoldTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: PlaceHoldInput,
  meta?: RequestMeta
) {
  {
    const unit = await lockUnit(tx, unitId);
    await assertCanRecordQuality(tx, actor, unit);
    assertActive(unit);
    if (isOnHold(unit)) throw errors.conflict("This unit is already on quality hold");
    const hold = await createHold(tx, actor, meta, unit, {
      kind: input.kind,
      reason: input.reason,
      origin: HoldOrigin.MANUAL,
    });
    return { holdId: hold.id };
  }
}

export async function releaseHold(
  actor: Actor,
  unitId: number,
  input: ReleaseHoldInput,
  meta?: RequestMeta
) {
  return prisma.$transaction((tx) => releaseHoldTx(tx, actor, unitId, input, meta), TRANSACTION);
}

/** Releases a unit's hold inside the caller's transaction (one unit, or each unit of a batch). */
export async function releaseHoldTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: ReleaseHoldInput,
  meta?: RequestMeta
) {
  assertCanReleaseHold(actor);
  const unit = await lockUnit(tx, unitId);
  const active = unit.holds[0];
  if (!active) throw errors.conflict("This unit is not on hold");

  await tx.unitHold.update({
    where: { id: active.id },
    data: { releasedAt: new Date(), releasedById: actor.id, releaseNote: input.note },
  });
  await recordAudit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "release",
    summary: `Released from quality hold (was: ${active.reason}) — ${input.note}`,
    reason: input.note,
    changes: [{ field: "hold", from: active.kind, to: null }],
  });
  return { released: true as const };
}

export async function recordLabTest(
  actor: Actor,
  unitId: number,
  input: RecordLabTestInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const unit = await lockUnit(tx, unitId);
    await assertCanRecordQuality(tx, actor, unit);
    assertActive(unit);

    const value = input.value ?? null;
    const wetWeight = input.wetWeight ?? null;
    const dryWeight = input.dryWeight ?? null;
    if (value === null && wetWeight === null && dryWeight === null && !input.comment) {
      throw errors.validation("Enter a result or a weight, or describe the result in the note");
    }

    const now = new Date();
    const testedAt = input.testedAt
      ? resolveEffectiveAt(input.testedAt, now, env().LAB_TIMEZONE)
      : now;
    if (!testedAt) throw errors.validation("The test date is not valid");
    if (testedAt.getTime() > now.getTime() + 1000) {
      throw errors.validation("A test cannot be dated in the future");
    }
    const tissueSample = input.tissueSampleId
      ? await tx.tissueSample.findFirst({
          where: { id: input.tissueSampleId, unitId: unit.id },
          select: { id: true, code: true },
        })
      : null;
    if (input.tissueSampleId && !tissueSample) {
      throw errors.validation("That sample was not taken from this unit", {
        fields: ["tissueSampleId"],
      });
    }

    const test = await tx.labTest.create({
      data: {
        unitId: unit.id,
        userId: actor.id,
        panel: input.panel,
        analyte: input.analyte ?? null,
        value,
        uom: input.uom ?? null,
        wetWeight,
        dryWeight,
        labName: input.labName ?? null,
        testedAt,
        comment: input.comment ?? null,
        tissueSampleId: tissueSample?.id ?? null,
      },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "lab_test",
      summary: `Recorded ${input.panel} result${tissueSample ? ` on sample ${tissueSample.code}` : ""}`,
      changes: [
        ...(value !== null
          ? [
              {
                field: input.analyte ? `${input.analyte} (${input.uom ?? "value"})` : "result",
                from: null,
                to: String(value),
              },
            ]
          : []),
        ...(wetWeight !== null
          ? [{ field: "wet weight (g)", from: null, to: String(wetWeight) }]
          : []),
        ...(dryWeight !== null
          ? [{ field: "dry weight (g)", from: null, to: String(dryWeight) }]
          : []),
      ],
    });
    return { testId: test.id };
  }, TRANSACTION);
}

export async function voidLabTest(
  actor: Actor,
  testId: number,
  input: VoidRecordInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const test = await tx.labTest.findUnique({
      where: { id: testId },
      include: { unit: { select: { id: true, name: true, experimentId: true } } },
    });
    if (!test || test.voidedAt) throw errors.notFound("Lab test");
    // The member who filed it (with edit rights on the unit), quality assurance or an admin.
    if (!isQuality(actor)) {
      if (test.userId !== actor.id)
        throw errors.forbidden("Only the member who recorded a test or an admin can void it");
      await assertCanEditUnit(tx, actor, test.unit);
    }
    await tx.labTest.update({
      where: { id: test.id },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: test.unit.id,
      entityLabel: test.unit.name,
      action: "void",
      summary: `Voided ${test.panel}${test.analyte ? ` / ${test.analyte}` : ""} result: ${input.reason}`,
      reason: input.reason,
    });
    return { voided: true as const };
  }, TRANSACTION);
}

// -----------------------------------------------------------------------------
// Incidents
// -----------------------------------------------------------------------------

export async function openIncident(actor: Actor, input: OpenIncidentInput, meta?: RequestMeta) {
  return prisma.$transaction(async (tx) => {
    let unit: LoadedUnit | null = null;
    if (input.unitId) {
      unit = await lockUnit(tx, input.unitId);
      await assertCanRecordQuality(tx, actor, unit);
    }
    if (input.experimentId) {
      const experiment = await tx.experiment.findUnique({
        where: { id: input.experimentId },
        select: { id: true },
      });
      if (!experiment) throw errors.notFound("Experiment");
      if (!isQuality(actor)) await assertCanEditExperiment(tx, actor, input.experimentId);
    }
    if (input.cultivarId) {
      const cultivar = await tx.cultivar.findUnique({
        where: { id: input.cultivarId },
        select: { id: true },
      });
      if (!cultivar) throw errors.notFound("Cultivar");
    }

    const incident = await tx.qualityIncident.create({
      data: {
        title: input.title,
        description: input.description,
        severity: input.severity,
        status: IncidentStatus.OPEN,
        unitId: unit?.id ?? null,
        cultivarId: input.cultivarId ?? null,
        experimentId: input.experimentId ?? null,
        userId: actor.id,
      },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "incident",
      entityId: incident.id,
      entityLabel: input.title,
      action: "incident_open",
      summary: `Opened ${input.severity} incident${unit ? ` on ${unit.name}` : ""}`,
    });

    const active =
      unit?.currentState && !(NO_STOCK_KINDS as readonly string[]).includes(unit.currentState.kind);
    const autoHeld =
      !!unit && !!active && input.severity === IncidentSeverity.CRITICAL && !isOnHold(unit);
    if (unit && autoHeld) {
      await createHold(tx, actor, meta, unit, {
        kind: HoldKind.HOLD,
        reason: `Auto-hold: critical incident — ${input.title}`,
        origin: HoldOrigin.AUTO_INCIDENT,
      });
    }
    return { incidentId: incident.id, autoHeld };
  }, TRANSACTION);
}

export async function updateIncident(
  actor: Actor,
  incidentId: number,
  input: UpdateIncidentInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const incident = await tx.qualityIncident.findUnique({
      where: { id: incidentId },
      include: { unit: { select: { experimentId: true } } },
    });
    if (!incident || incident.voidedAt) throw errors.notFound("Incident");

    if (incident.unit) await assertCanRecordQuality(tx, actor, incident.unit);
    else assertCanManageIncidents(actor);

    const status = input.status ?? incident.status;
    const resolution = input.resolution !== undefined ? input.resolution : incident.resolution;
    const sopId = input.sopId !== undefined ? input.sopId : incident.sopId;
    const sop =
      sopId === null
        ? null
        : await tx.sop.findUnique({ where: { id: sopId }, select: { code: true } });
    if (sopId !== null && !sop) throw errors.notFound("Procedure");
    const before =
      incident.sopId === null
        ? null
        : await tx.sop.findUnique({ where: { id: incident.sopId }, select: { code: true } });
    if (status === IncidentStatus.CLOSED && !resolution) {
      throw errors.validation("A resolution is required to close an incident");
    }
    if (status === IncidentStatus.CLOSED && incident.status !== IncidentStatus.CLOSED) {
      const open = await tx.capaAction.count({
        where: { incidentId: incident.id, status: "OPEN" },
      });
      if (open > 0) {
        throw errors.conflict("Finish its corrective and preventive actions first", {
          reason: "capaOpen",
          values: { count: open },
        });
      }
    }

    const changes = buildChanges([
      { field: "status", from: incident.status, to: status },
      { field: "resolution", from: incident.resolution, to: resolution },
      { field: "procedure", from: before?.code ?? null, to: sop?.code ?? null },
    ]);
    if (changes.length === 0) return { unchanged: true as const };

    await tx.qualityIncident.update({
      where: { id: incident.id },
      data: {
        status,
        resolution: resolution ?? null,
        sopId,
        closedAt: status === IncidentStatus.CLOSED ? (incident.closedAt ?? new Date()) : null,
      },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "incident",
      entityId: incident.id,
      entityLabel: incident.title,
      action: "incident_update",
      summary: `Incident ${incident.title} → ${status}`,
      changes,
    });
    return { unchanged: false as const, status };
  }, TRANSACTION);
}

export async function voidIncident(
  actor: Actor,
  incidentId: number,
  input: VoidRecordInput,
  meta?: RequestMeta
) {
  assertCanManageIncidents(actor);
  return prisma.$transaction(async (tx) => {
    const incident = await tx.qualityIncident.findUnique({ where: { id: incidentId } });
    if (!incident || incident.voidedAt) throw errors.notFound("Incident");
    await tx.qualityIncident.update({
      where: { id: incident.id },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "incident",
      entityId: incident.id,
      entityLabel: incident.title,
      action: "void",
      summary: `Voided incident ${incident.title}: ${input.reason}`,
      reason: input.reason,
    });
    return { voided: true as const };
  }, TRANSACTION);
}
