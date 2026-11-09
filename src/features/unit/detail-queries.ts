import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ActivityType,
  AttachmentCategory,
  GrowthStage,
  HoldKind,
  HoldOrigin,
  IncidentSeverity,
  IncidentStatus,
  MaterialClass as ShipmentMaterial,
  Moisture,
  SampleKind,
  SourceType,
  TestPanel,
  UnitStateKind,
  UnitType,
  WasteType,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { buildUnitLedger, type LedgerEvent } from "@/lib/ledger";
import { deriveLifecycleStageId, type LifecycleStageId } from "@/lib/lifecycle-stages";
import { likeEscape } from "@/lib/search-text";
import { summarizeStageDurations, type StageDurationSummary } from "@/lib/stage-durations";
import { summarizeShipping, type ShippingSummary } from "@/lib/unit-shipping";
import {
  buildLocationHistory,
  buildMotherLineage,
  MAX_LINEAGE_DEPTH,
  type LocationHistory,
  type MotherLineage,
  type UnitRef,
} from "@/lib/traceability";
import {
  deriveMaterialClass,
  summarizeWeights,
  terminalKindOf,
  unitStatusOf,
  type MaterialClass,
  type TerminalKind,
  type UnitStatusKey,
} from "@/lib/unit-profile";
import { canEditExperiment, isAdmin, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { isQuality, isReadOnly, worksOnAllUnits } from "@/lib/roles";
import { projectHarvest, type HarvestProjection } from "@/lib/harvest-projection";
import type { TissueKind } from "./schemas";

/**
 * Everything the unit detail and audit-export pages read. Every query takes the signed-in user and
 * applies `unitReadScope`, so narrowing who can see which unit stays a one-place change. Results are
 * plain view models: enums and numbers (weights are grams as numbers), `Date` for instants, no
 * Prisma objects and no English labels.
 */

const CHILD_LIMIT = 100;
const LEDGER_SOURCE_LIMIT = 200;
const AUDIT_LIMIT = 200;
const EXPERIMENT_CHAIN_LIMIT = 20;

type Named = { id: number; name: string };

export type UnitAccess = {
  /** Admin, inventory manager, or a member of the unit's experiment: may record events on the unit. */
  canEdit: boolean;
  isAdmin: boolean;
  /** May place holds and record lab results and incidents (quality assurance, or `canEdit`). */
  canRecordQuality: boolean;
  /** May release a hold (admins and quality assurance). */
  canReleaseHold: boolean;
  /** May record a destruction: administrators, and members of the unit's experiment. */
  canDestroy: boolean;
};

export type UnitHoldView = {
  id: number;
  kind: HoldKind;
  origin: HoldOrigin;
  reason: string;
  placedAt: Date;
  placedBy: string;
  placedById: number;
  releasedAt: Date | null;
  releasedBy: string | null;
  releasedById: number | null;
  releaseNote: string | null;
};

export type UnitCurrentState = {
  sequence: number;
  kind: UnitStateKind;
  effectiveAt: Date;
  recordedAt: Date;
  recordedBy: string | null;
  recordedById: number | null;
  locationId: number | null;
  locationName: string | null;
  growthStage: GrowthStage | null;
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
  /** A plant group's number of plants; null means one plant. */
  plantCount: number | null;
};

export type UnitProfile = {
  id: number;
  /** Short code made by the database (U-0001). */
  code: string;
  name: string;
  type: UnitType;
  /** Set when the unit is a sample of its parent. */
  sampleKind: SampleKind | null;
  sex: string | null;
  notes: string | null;
  /** When the registration was typed in (filed). */
  createdAt: Date;
  /** When the unit came into the laboratory: the effective date of its first event. */
  registeredAt: Date;
  material: MaterialClass;
  status: UnitStatusKey;
  /** Set once the unit has left inventory. */
  terminal: TerminalKind | null;
  /** The lifecycle bucket while the unit is in inventory. */
  stage: LifecycleStageId | null;
  cultivar: Named | null;
  experiment: {
    id: number;
    ecode: string;
    name: string;
    leadName: string | null;
    leadId: number | null;
  } | null;
  source: {
    type: SourceType | null;
    description: string | null;
    provider: { id: number; name: string; country: string | null } | null;
    receivedAt: Date | null;
    receptionNote: string | null;
  };
  current: UnitCurrentState | null;
  weights: {
    humid: number | null;
    dry: number | null;
    /** Effective date of the event that last changed a weight. */
    changedAt: Date | null;
    /** When the dry weight was last weighed (a shipment takes from it, it does not weigh it). */
    dryMeasuredAt: Date | null;
    isHarvested: boolean;
  };
  hold: UnitHoldView | null;
  destruction: {
    at: Date;
    reason: string | null;
    witness: string | null;
    witnessId: number | null;
    recordedBy: string | null;
    recordedById: number | null;
    recordedAt: Date;
  } | null;
  /** What shipping has taken from the unit so far; null when nothing has shipped. */
  shipping: ShippingSummary | null;
  /** For a vegetative or flowering plant with a cultivar growth profile: what to expect. */
  projection: HarvestProjection | null;
  /** Set once the plant group merged into another group. */
  merge: { into: { id: number; name: string } | null; at: Date } | null;
  /** Set once everything that was left has shipped. */
  shipment: {
    at: Date;
    organization: string | null;
    organizationId: number | null;
    recordedBy: string | null;
    recordedById: number | null;
    recordedAt: Date;
  } | null;
  parent: (UnitRef & { note: string | null }) | null;
  lineage: MotherLineage;
  children: Array<UnitRef & { note: string | null }>;
  childCount: number;
  experimentChain: Array<{ id: number; ecode: string; name: string }>;
  subExperiments: Array<{ id: number; ecode: string; name: string; fromThisUnit: boolean }>;
  stageDurations: StageDurationSummary;
  locationHistory: LocationHistory;
  access: UnitAccess;
};

async function loadAncestry(user: SessionUser, startParentId: number | null): Promise<UnitRef[]> {
  const ancestry: UnitRef[] = [];
  const seen = new Set<number>();
  let cursor = startParentId;
  while (cursor !== null && !seen.has(cursor) && ancestry.length < MAX_LINEAGE_DEPTH) {
    seen.add(cursor);
    const parent: (UnitRef & { sourceParentUnitId: number | null }) | null =
      await prisma.biologicalUnit.findFirst({
        where: { AND: [{ id: cursor }, unitReadScope(user)] },
        select: { id: true, name: true, type: true, sourceParentUnitId: true },
      });
    if (!parent) break;
    ancestry.unshift({ id: parent.id, name: parent.name, type: parent.type });
    cursor = parent.sourceParentUnitId;
  }
  return ancestry;
}

async function loadExperimentChain(experimentId: number | null) {
  const chain: Array<{ id: number; ecode: string; name: string }> = [];
  const seen = new Set<number>();
  let cursor = experimentId;
  while (cursor && !seen.has(cursor) && chain.length < EXPERIMENT_CHAIN_LIMIT) {
    seen.add(cursor);
    const experiment: {
      id: number;
      ecode: string;
      name: string;
      parentExperimentId: number | null;
    } | null = await prisma.experiment.findUnique({
      where: { id: cursor },
      select: { id: true, ecode: true, name: true, parentExperimentId: true },
    });
    if (!experiment) break;
    chain.unshift({ id: experiment.id, ecode: experiment.ecode, name: experiment.name });
    cursor = experiment.parentExperimentId;
  }
  return chain;
}

const toNumber = (value: { toString(): string } | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

/** The unit page's core record, or null when the unit does not exist or is outside the user's scope. */
export async function getUnitProfile(
  user: SessionUser,
  unitId: number
): Promise<UnitProfile | null> {
  const unit = await prisma.biologicalUnit.findFirst({
    where: { AND: [{ id: unitId }, unitReadScope(user)] },
    include: {
      cultivar: {
        select: {
          id: true,
          name: true,
          vegetativeDays: true,
          floweringDays: true,
          expectedYieldGrams: true,
        },
      },
      experiment: {
        select: {
          id: true,
          ecode: true,
          name: true,
          members: {
            where: { role: "LEAD" },
            take: 1,
            select: { user: { select: { id: true, name: true } } },
          },
        },
      },
      providerOrganization: { select: { id: true, name: true, country: true } },
      sourceParentUnit: { select: { id: true, name: true, type: true } },
      derivedUnits: {
        select: { id: true, name: true, type: true, sourceDescription: true },
        orderBy: { id: "asc" },
        take: CHILD_LIMIT,
      },
      _count: { select: { derivedUnits: true } },
      holds: {
        where: { releasedAt: null },
        include: { placedBy: { select: { id: true, name: true } } },
        orderBy: { placedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!unit) return null;

  const [stateRows, canEdit, ancestry, experimentChain, subExperiments] = await Promise.all([
    prisma.unitState.findMany({
      where: { unitId },
      orderBy: { sequence: "asc" },
      include: {
        location: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true, country: true } },
        recordedBy: { select: { id: true, name: true } },
        witness: { select: { id: true, name: true } },
        shipmentItem: {
          select: { materialType: true, shipment: { select: { id: true, reference: true } } },
        },
      },
    }),
    canEditExperiment(prisma, user, unit.experimentId),
    loadAncestry(user, unit.sourceParentUnitId),
    loadExperimentChain(unit.experimentId),
    prisma.experiment.findMany({
      where: unit.experimentId
        ? { OR: [{ sourceUnitId: unitId }, { parentExperimentId: unit.experimentId }] }
        : { sourceUnitId: unitId },
      select: { id: true, ecode: true, name: true, sourceUnitId: true },
      orderBy: { startDate: "desc" },
      take: 50,
    }),
  ]);

  const history = stateRows.map((s) => ({
    ...s,
    humidWeight: toNumber(s.humidWeight),
    dryWeight: toNumber(s.dryWeight),
  }));
  const currentRow =
    history.find((s) => s.id === unit.currentStateId) ?? history[history.length - 1] ?? null;

  const terminal = terminalKindOf(currentRow?.kind);
  const hold = unit.holds[0] ?? null;
  const firstReceived = history.find((s) => s.kind === "RECEIVED");
  const provider = firstReceived?.organization ?? unit.providerOrganization;
  const weights = summarizeWeights(unit.type, history);

  const destroyed = terminal === "DESTROYED" ? currentRow : null;
  const shipped = terminal === "SHIPPED" ? currentRow : null;
  const merged = terminal === "MERGED" ? currentRow : null;
  const mergedInto = merged?.parentStateId
    ? await prisma.unitState.findUnique({
        where: { id: merged.parentStateId },
        select: { unit: { select: { id: true, name: true } } },
      })
    : null;

  const stageDurations = summarizeStageDurations(history, {
    endedAt: terminal ? currentRow?.effectiveAt : null,
  });
  return {
    id: unit.id,
    code: unit.code,
    name: unit.name,
    type: unit.type,
    sampleKind: unit.sampleKind,
    sex: unit.sex,
    notes: unit.comment,
    createdAt: unit.createdAt,
    registeredAt: history[0]?.effectiveAt ?? unit.createdAt,
    material: deriveMaterialClass(unit.type, {
      hasParent: unit.sourceParentUnit !== null,
      hasProvider: provider !== null && provider !== undefined,
    }),
    status: unitStatusOf(currentRow?.kind, hold?.kind ?? null),
    terminal,
    stage: terminal
      ? null
      : deriveLifecycleStageId({ type: unit.type, currentState: currentRow ?? null }),
    cultivar: unit.cultivar ? { id: unit.cultivar.id, name: unit.cultivar.name } : null,
    experiment: unit.experiment
      ? {
          id: unit.experiment.id,
          ecode: unit.experiment.ecode,
          name: unit.experiment.name,
          leadName: unit.experiment.members[0]?.user.name ?? null,
          leadId: unit.experiment.members[0]?.user.id ?? null,
        }
      : null,
    source: {
      type: unit.sourceType,
      description: unit.sourceDescription,
      provider: provider
        ? { id: provider.id, name: provider.name, country: provider.country }
        : null,
      receivedAt: provider ? (firstReceived?.effectiveAt ?? history[0]?.effectiveAt ?? null) : null,
      receptionNote: firstReceived?.comment ?? null,
    },
    current: currentRow
      ? {
          sequence: currentRow.sequence,
          kind: currentRow.kind,
          effectiveAt: currentRow.effectiveAt,
          recordedAt: currentRow.recordedAt,
          recordedBy: currentRow.recordedBy.name,
          recordedById: currentRow.recordedBy.id,
          locationId: currentRow.locationId,
          locationName: currentRow.location?.name ?? null,
          growthStage: currentRow.growthStage,
          humidWeight: currentRow.humidWeight,
          dryWeight: currentRow.dryWeight,
          seedCount: currentRow.seedCount,
          plantCount: currentRow.plantCount,
        }
      : null,
    weights: {
      humid: weights.humidWeight,
      dry: weights.dryWeight,
      changedAt: weights.changedAt,
      dryMeasuredAt:
        history.findLast(
          (state, index) =>
            state.kind !== "SHIPPED" &&
            state.kind !== "SHIPPED_PART" &&
            state.dryWeight !== null &&
            state.dryWeight !== (history[index - 1]?.dryWeight ?? null)
        )?.effectiveAt ?? null,
      isHarvested: weights.isHarvested,
    },
    hold: hold
      ? {
          id: hold.id,
          kind: hold.kind,
          origin: hold.origin,
          reason: hold.reason,
          placedAt: hold.placedAt,
          placedBy: hold.placedBy.name,
          placedById: hold.placedBy.id,
          releasedAt: null,
          releasedBy: null,
          releasedById: null,
          releaseNote: null,
        }
      : null,
    destruction: destroyed
      ? {
          at: destroyed.effectiveAt,
          reason: destroyed.reason,
          witness: destroyed.witness?.name ?? null,
          witnessId: destroyed.witness?.id ?? null,
          recordedBy: destroyed.recordedBy.name,
          recordedById: destroyed.recordedBy.id,
          recordedAt: destroyed.recordedAt,
        }
      : null,
    shipping: summarizeShipping(
      history.map((s) => ({
        kind: s.kind,
        at: s.effectiveAt,
        organization: s.organization ? { id: s.organization.id, name: s.organization.name } : null,
        shipment: s.shipmentItem
          ? { ...s.shipmentItem.shipment, materialType: s.shipmentItem.materialType }
          : null,
        humidWeight: s.humidWeight,
        dryWeight: s.dryWeight,
        seedCount: s.seedCount,
        shippedWeight: toNumber(s.shippedWeight),
        shippedMoisture: s.shippedMoisture,
        shippedCount: s.shippedCount,
      }))
    ),
    projection:
      unit.type === "PLANT" && !terminal
        ? projectHarvest({
            stage: currentRow?.growthStage ?? null,
            stageSince: stageDurations.current?.start ?? null,
            plants: currentRow?.plantCount ?? 1,
            profile: unit.cultivar,
          })
        : null,
    merge: merged ? { into: mergedInto?.unit ?? null, at: merged.effectiveAt } : null,
    shipment: shipped
      ? {
          at: shipped.effectiveAt,
          organization: shipped.organization?.name ?? null,
          organizationId: shipped.organization?.id ?? null,
          recordedBy: shipped.recordedBy.name,
          recordedById: shipped.recordedBy.id,
          recordedAt: shipped.recordedAt,
        }
      : null,
    parent: unit.sourceParentUnit
      ? { ...unit.sourceParentUnit, note: unit.sourceDescription }
      : null,
    lineage: buildMotherLineage(ancestry),
    children: unit.derivedUnits.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      note: c.sourceDescription,
    })),
    childCount: unit._count.derivedUnits,
    experimentChain,
    subExperiments: subExperiments.map((e) => ({
      id: e.id,
      ecode: e.ecode,
      name: e.name,
      fromThisUnit: e.sourceUnitId === unitId,
    })),
    stageDurations,
    locationHistory: buildLocationHistory(
      history.map((s) => ({
        sequence: s.sequence,
        kind: s.kind,
        effectiveAt: s.effectiveAt,
        scanConfirmed: s.scanConfirmed,
        comment: s.comment,
        locationId: s.locationId,
        location: s.location,
        recordedBy: s.recordedBy,
      }))
    ),
    // An inspector changes nothing, even on an experiment they were added to.
    access: {
      canEdit: !isReadOnly(user) && (canEdit || worksOnAllUnits(user)),
      isAdmin: isAdmin(user),
      canRecordQuality: !isReadOnly(user) && (canEdit || worksOnAllUnits(user) || isQuality(user)),
      canReleaseHold: isQuality(user),
      // Administrators, and members of the unit's experiment (not inventory or quality roles).
      canDestroy: isAdmin(user) || (user.permissions === "REGULAR" && canEdit),
    },
  };
}

/** True when the unit exists and the user may read it. Cheap guard for the secondary queries. */
async function isVisible(user: SessionUser, unitId: number): Promise<boolean> {
  const count = await prisma.biologicalUnit.count({
    where: { AND: [{ id: unitId }, unitReadScope(user)] },
  });
  return count > 0;
}

// --- History ----------------------------------------------------------------------------------------

/** The unit's ledger: every recorded event and related record, newest first. Empty if not visible. */
export async function getUnitLedger(user: SessionUser, unitId: number): Promise<LedgerEvent[]> {
  const unit = await prisma.biologicalUnit.findFirst({
    where: { AND: [{ id: unitId }, unitReadScope(user)] },
    select: {
      name: true,
      type: true,
      sourceType: true,
      cultivar: { select: { id: true, name: true } },
      experiment: { select: { ecode: true } },
      sourceParentUnit: { select: { id: true, name: true } },
    },
  });
  if (!unit) return [];

  const [states, derived, holds, activities, attachments, shipments, tests, incidents, audits] =
    await Promise.all([
      prisma.unitState.findMany({
        where: { unitId },
        include: {
          location: { select: { id: true, name: true } },
          organization: { select: { id: true, name: true } },
          witness: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
          parentState: { select: { unit: { select: { id: true, name: true } } } },
        },
        orderBy: { sequence: "asc" },
      }),
      prisma.biologicalUnit.findMany({
        where: { sourceParentUnitId: unitId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          states: {
            where: { sequence: 1 },
            select: { effectiveAt: true, recordedBy: { select: { id: true, name: true } } },
          },
        },
        orderBy: { id: "asc" },
        take: LEDGER_SOURCE_LIMIT,
      }),
      prisma.unitHold.findMany({
        where: { unitId },
        include: {
          placedBy: { select: { id: true, name: true } },
          releasedBy: { select: { id: true, name: true } },
        },
        orderBy: { placedAt: "asc" },
      }),
      prisma.unitActivity.findMany({
        where: { unitId },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { date: "desc" },
        take: LEDGER_SOURCE_LIMIT,
      }),
      prisma.unitAttachment.findMany({
        where: { unitId, voidedAt: null },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: LEDGER_SOURCE_LIMIT,
      }),
      prisma.shipmentItem.findMany({
        where: { unitId, shipment: { voidedAt: null } },
        include: {
          shipment: {
            select: {
              id: true,
              reference: true,
              direction: true,
              status: true,
              shippedDate: true,
              createdAt: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
        take: LEDGER_SOURCE_LIMIT,
      }),
      prisma.labTest.findMany({
        where: { unitId, voidedAt: null },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { testedAt: "desc" },
        take: LEDGER_SOURCE_LIMIT,
      }),
      prisma.qualityIncident.findMany({
        where: { unitId, voidedAt: null },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: LEDGER_SOURCE_LIMIT,
      }),
      prisma.auditLog.findMany({
        where: { entityType: "unit", entityId: unitId },
        orderBy: { createdAt: "desc" },
        take: AUDIT_LIMIT,
      }),
    ]);

  return buildUnitLedger({
    unit: {
      name: unit.name,
      type: unit.type,
      cultivarName: unit.cultivar?.name ?? null,
      experimentCode: unit.experiment?.ecode ?? null,
      sourceType: unit.sourceType,
      sourceParent: unit.sourceParentUnit,
    },
    states: states.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      kind: s.kind,
      effectiveAt: s.effectiveAt,
      recordedAt: s.recordedAt,
      recordedBy: s.recordedBy.name,
      recordedById: s.recordedBy.id,
      locationName: s.location?.name ?? null,
      growthStage: s.growthStage,
      humidWeight: toNumber(s.humidWeight),
      dryWeight: toNumber(s.dryWeight),
      seedCount: s.seedCount,
      shippedWeight: toNumber(s.shippedWeight),
      shippedMoisture: s.shippedMoisture,
      shippedCount: s.shippedCount,
      wasteType: s.wasteType,
      plantCount: s.plantCount,
      organizationName: s.organization?.name ?? null,
      scanConfirmed: s.scanConfirmed,
      reason: s.reason,
      witnessName: s.witness?.name ?? null,
      comment: s.comment,
      parentStateId: s.parentStateId,
      parentUnit: s.parentState?.unit ?? null,
    })),
    derived: derived.map((child) => ({
      id: child.id,
      name: child.name,
      at: child.states[0]?.effectiveAt ?? child.createdAt,
      actor: child.states[0]?.recordedBy.name ?? null,
    })),
    holds: holds.map((h) => ({
      id: h.id,
      kind: h.kind,
      origin: h.origin,
      reason: h.reason,
      placedAt: h.placedAt,
      placedBy: h.placedBy.name,
      placedById: h.placedBy.id,
      releasedAt: h.releasedAt,
      releasedBy: h.releasedBy?.name ?? null,
      releasedById: h.releasedBy?.id ?? null,
      releaseNote: h.releaseNote,
    })),
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      details: a.details,
      date: a.date,
      actor: a.user.name,
      actorId: a.user.id,
      product: a.product,
      pcpNumber: a.pcpNumber,
      amount: toNumber(a.amount),
      amountUnit: a.amountUnit,
      method: a.method,
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      label: a.label,
      fileName: a.fileName,
      category: a.category,
      createdAt: a.createdAt,
      actor: a.user.name,
    })),
    shipments: shipments.map((item) => ({
      shipmentId: item.shipment.id,
      reference: item.shipment.reference,
      direction: item.shipment.direction,
      status: item.shipment.status,
      description: item.description,
      stateId: item.stateId,
      at: item.shipment.shippedDate ?? item.shipment.createdAt,
      actor: item.shipment.user.name,
    })),
    tests: tests.map((t) => ({
      id: t.id,
      panel: t.panel,
      analyte: t.analyte,
      value: t.value,
      uom: t.uom,
      wetWeight: t.wetWeight,
      dryWeight: t.dryWeight,
      labName: t.labName,
      comment: t.comment,
      testedAt: t.testedAt,
      createdAt: t.createdAt,
      actor: t.user.name,
      actorId: t.user.id,
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      createdAt: i.createdAt,
      actor: i.user.name,
      actorId: i.user.id,
    })),
    audits: audits.map((a) => ({
      id: a.id,
      action: a.action,
      summary: a.summary,
      changes: a.details,
      reason: a.reason,
      createdAt: a.createdAt,
      actor: a.userName,
    })),
  });
}

/** The unit's immutable events as recorded, oldest first (the order they were filed in). */
export type UnitStateRow = {
  id: number;
  sequence: number;
  kind: UnitStateKind;
  effectiveAt: Date;
  recordedAt: Date;
  recordedBy: string;
  locationName: string | null;
  growthStage: GrowthStage | null;
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
  plantCount: number | null;
  organizationName: string | null;
  /** On a shipment: what left with it (grams on the given basis, or a count) and its reference. */
  shipped: {
    weight: number | null;
    moisture: Moisture | null;
    count: number | null;
    reference: string | null;
    /** What the shipment line was (seeds, clones, flower...); null for older records. */
    material: ShipmentMaterial | null;
  } | null;
  /** On a SAMPLED event: what the sample took. */
  sampled: { weight: number | null; moisture: Moisture | null; count: number | null } | null;
  /** On a WASTED event: what was disposed of, how much and on which basis. */
  wasted: { weight: number | null; moisture: Moisture | null; type: WasteType | null } | null;
  scanConfirmed: boolean;
  reason: string | null;
  witnessName: string | null;
  comment: string | null;
};

export async function getUnitStates(user: SessionUser, unitId: number): Promise<UnitStateRow[]> {
  const rows = await prisma.unitState.findMany({
    where: { unitId, unit: unitReadScope(user) },
    orderBy: { sequence: "asc" },
    include: {
      location: { select: { id: true, name: true } },
      organization: { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
      witness: { select: { id: true, name: true } },
      shipmentItem: {
        select: { materialType: true, shipment: { select: { reference: true } } },
      },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    sequence: s.sequence,
    kind: s.kind,
    effectiveAt: s.effectiveAt,
    recordedAt: s.recordedAt,
    recordedBy: s.recordedBy.name,
    locationName: s.location?.name ?? null,
    growthStage: s.growthStage,
    humidWeight: toNumber(s.humidWeight),
    dryWeight: toNumber(s.dryWeight),
    seedCount: s.seedCount,
    plantCount: s.plantCount,
    organizationName: s.organization?.name ?? null,
    shipped:
      s.kind === "SHIPPED" || s.kind === "SHIPPED_PART"
        ? {
            weight: toNumber(s.shippedWeight),
            moisture: s.shippedMoisture,
            count: s.shippedCount,
            reference: s.shipmentItem?.shipment.reference ?? null,
            material: s.shipmentItem?.materialType ?? null,
          }
        : null,
    wasted:
      s.kind === "WASTED"
        ? { weight: toNumber(s.shippedWeight), moisture: s.shippedMoisture, type: s.wasteType }
        : null,
    sampled:
      s.kind === "SAMPLED"
        ? { weight: toNumber(s.shippedWeight), moisture: s.shippedMoisture, count: s.shippedCount }
        : null,
    scanConfirmed: s.scanConfirmed,
    reason: s.reason,
    witnessName: s.witness?.name ?? null,
    comment: s.comment,
  }));
}

// --- Quality ----------------------------------------------------------------------------------------

export type UnitTestView = {
  id: number;
  panel: TestPanel;
  analyte: string | null;
  value: number | null;
  uom: string | null;
  wetWeight: number | null;
  dryWeight: number | null;
  labName: string | null;
  comment: string | null;
  testedAt: Date;
  recordedAt: Date;
  recordedBy: string;
  recordedById: number;
  /** The tissue sample it was tested on, if any. */
  sample: string | null;
};

export type UnitIncidentView = {
  id: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  resolution: string | null;
  openedAt: Date;
  closedAt: Date | null;
  openedBy: string;
  openedById: number;
};

export type UnitSampleView = {
  id: number;
  name: string;
  kind: SampleKind;
  takenAt: Date;
  wet: number | null;
  dry: number | null;
  seeds: number | null;
  /** Lab results recorded on the sample. */
  tests: number;
};

/** A tissue sample of a plant or a culture, taken for a lab test. */
export type UnitTissueSampleView = {
  id: number;
  code: string;
  purpose: "PATHOGEN" | "SEX" | "IDENTITY" | "OTHER";
  tissue: TissueKind;
  note: string | null;
  takenAt: Date;
  takenBy: string;
  takenById: number;
  tests: number;
};

export type UnitQuality = {
  tests: UnitTestView[];
  /** Tissue samples taken from this plant or culture, newest first. */
  tissueSamples: UnitTissueSampleView[];
  incidents: UnitIncidentView[];
  /** Samples taken from this unit, newest first. */
  samples: UnitSampleView[];
  /** Every hold the unit has had, newest first, the active one included. */
  holds: UnitHoldView[];
};

export async function getUnitQuality(user: SessionUser, unitId: number): Promise<UnitQuality> {
  if (!(await isVisible(user, unitId))) {
    return { tests: [], incidents: [], holds: [], samples: [], tissueSamples: [] };
  }

  const [tests, incidents, holds, samples, tissueSamples] = await Promise.all([
    prisma.labTest.findMany({
      where: { unitId, voidedAt: null },
      include: {
        user: { select: { id: true, name: true } },
        tissueSample: { select: { code: true } },
      },
      orderBy: [{ testedAt: "desc" }, { id: "desc" }],
    }),
    prisma.qualityIncident.findMany({
      where: { unitId, voidedAt: null },
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.unitHold.findMany({
      where: { unitId },
      include: {
        placedBy: { select: { id: true, name: true } },
        releasedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    }),
    prisma.biologicalUnit.findMany({
      where: {
        AND: [unitReadScope(user), { sourceParentUnitId: unitId, sampleKind: { not: null } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        name: true,
        sampleKind: true,
        states: {
          orderBy: { sequence: "asc" },
          take: 1,
          select: { effectiveAt: true, humidWeight: true, dryWeight: true, seedCount: true },
        },
        _count: { select: { labTests: { where: { voidedAt: null } } } },
      },
    }),
    prisma.tissueSample.findMany({
      where: { unitId },
      orderBy: [{ takenAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        code: true,
        purpose: true,
        tissue: true,
        note: true,
        takenAt: true,
        takenBy: { select: { id: true, name: true } },
        _count: { select: { labTests: { where: { voidedAt: null } } } },
      },
    }),
  ]);

  return {
    tests: tests.map((t) => ({
      id: t.id,
      panel: t.panel,
      analyte: t.analyte,
      value: t.value,
      uom: t.uom,
      wetWeight: t.wetWeight,
      dryWeight: t.dryWeight,
      labName: t.labName,
      comment: t.comment,
      testedAt: t.testedAt,
      recordedAt: t.createdAt,
      recordedBy: t.user.name,
      recordedById: t.user.id,
      sample: t.tissueSample?.code ?? null,
    })),
    tissueSamples: tissueSamples.map((s) => ({
      id: s.id,
      code: s.code,
      purpose: s.purpose,
      // Stored as text; the service only ever writes one of the kinds.
      tissue: s.tissue as TissueKind,
      note: s.note,
      takenAt: s.takenAt,
      takenBy: s.takenBy.name,
      takenById: s.takenBy.id,
      tests: s._count.labTests,
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      description: i.description,
      resolution: i.resolution,
      openedAt: i.createdAt,
      closedAt: i.closedAt,
      openedBy: i.user.name,
      openedById: i.user.id,
    })),
    samples: samples.map((sample) => ({
      id: sample.id,
      name: sample.name,
      kind: sample.sampleKind!,
      takenAt: sample.states[0]?.effectiveAt ?? new Date(0),
      wet: toNumber(sample.states[0]?.humidWeight),
      dry: toNumber(sample.states[0]?.dryWeight),
      seeds: sample.states[0]?.seedCount ?? null,
      tests: sample._count.labTests,
    })),
    holds: holds.map((h) => ({
      id: h.id,
      kind: h.kind,
      origin: h.origin,
      reason: h.reason,
      placedAt: h.placedAt,
      placedBy: h.placedBy.name,
      placedById: h.placedBy.id,
      releasedAt: h.releasedAt,
      releasedBy: h.releasedBy?.name ?? null,
      releasedById: h.releasedBy?.id ?? null,
      releaseNote: h.releaseNote,
    })),
  };
}

// --- Documents and activity -------------------------------------------------------------------------

export type UnitAttachmentView = {
  id: number;
  label: string;
  fileName: string;
  category: AttachmentCategory;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  uploadedAt: Date;
  uploadedBy: string;
  uploadedById: number;
};

export type UnitActivityView = {
  id: number;
  type: ActivityType;
  title: string;
  details: string | null;
  /** What was applied, its PCP registration number, how much and how; null where not recorded. */
  product: string | null;
  pcpNumber: string | null;
  amount: number | null;
  amountUnit: string | null;
  method: string | null;
  date: Date;
  recordedBy: string;
  recordedById: number;
};

export type UnitDocuments = {
  attachments: UnitAttachmentView[];
  activities: UnitActivityView[];
};

export async function getUnitDocuments(user: SessionUser, unitId: number): Promise<UnitDocuments> {
  if (!(await isVisible(user, unitId))) return { attachments: [], activities: [] };

  const [attachments, activities] = await Promise.all([
    prisma.unitAttachment.findMany({
      where: { unitId, voidedAt: null },
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.unitActivity.findMany({
      where: { unitId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    }),
  ]);

  return {
    attachments: attachments.map((a) => ({
      id: a.id,
      label: a.label,
      fileName: a.fileName,
      category: a.category,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      uploadedAt: a.createdAt,
      uploadedBy: a.user.name,
      uploadedById: a.user.id,
    })),
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      details: a.details,
      date: a.date,
      recordedBy: a.user.name,
      recordedById: a.user.id,
      product: a.product,
      pcpNumber: a.pcpNumber,
      amount: toNumber(a.amount),
      amountUnit: a.amountUnit,
      method: a.method,
    })),
  };
}

// --- Choices for the action forms -------------------------------------------------------------------

/** Units matching `q` that could be linked as this unit's parent. Never the unit itself. */
export async function searchParentCandidates(
  user: SessionUser,
  unitId: number,
  q: string,
  limit = 15
): Promise<Array<{ id: number; name: string; type: UnitType }>> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const where: Prisma.BiologicalUnitWhereInput = {
    AND: [
      unitReadScope(user),
      { id: { not: unitId } },
      { name: { contains: likeEscape(needle), mode: "insensitive" } },
    ],
  };
  return prisma.biologicalUnit.findMany({
    where,
    orderBy: { name: "asc" },
    take: limit,
    select: { id: true, name: true, type: true },
  });
}
