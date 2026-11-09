import type {
  ActivityType,
  AttachmentCategory,
  GrowthStage,
  HoldKind,
  HoldOrigin,
  IncidentSeverity,
  IncidentStatus,
  ShipmentDirection,
  ShipmentStatus,
  SourceType,
  TestPanel,
  UnitStateKind,
  UnitType,
} from "@/generated/prisma/enums";
import { LAB_RESULTS_SHOWN } from "./lab-results";
import type { LedgerEvent, LedgerFacts } from "./ledger-types";

export type { LedgerEvent, LedgerEventType, LedgerFacts } from "./ledger-types";

/**
 * Builds the unit's ledger from plain rows. Pure: the database reads live in
 * `features/unit/queries.ts`, which hands the rows over, so the assembly is unit-testable and the
 * output holds enums and numbers, never sentences.
 *
 * Voided records are left out of the input (their void shows up through the audit trail).
 */
type Named = { id: number; name: string };

export type LedgerSource = {
  unit: {
    name: string;
    type: UnitType;
    cultivarName: string | null;
    experimentCode: string | null;
    sourceType: SourceType | null;
    sourceParent: Named | null;
  };
  /** Every state of the unit, any order. */
  states: Array<{
    id: number;
    sequence: number;
    kind: UnitStateKind;
    effectiveAt: Date;
    recordedAt: Date;
    recordedBy: string | null;
    recordedById?: number | null;
    locationName: string | null;
    growthStage: GrowthStage | null;
    humidWeight: number | null;
    dryWeight: number | null;
    seedCount: number | null;
    shippedWeight?: number | null;
    shippedMoisture?: "WET" | "DRY" | null;
    shippedCount?: number | null;
    wasteType?: string | null;
    plantCount?: number | null;
    organizationName: string | null;
    scanConfirmed: boolean;
    reason: string | null;
    witnessName: string | null;
    comment: string | null;
    parentStateId: number | null;
    parentUnit: Named | null;
  }>;
  derived: Array<{ id: number; name: string; at: Date; actor: string | null }>;
  holds: Array<{
    id: number;
    kind: HoldKind;
    origin: HoldOrigin;
    reason: string;
    placedAt: Date;
    placedBy: string;
    placedById?: number | null;
    releasedAt: Date | null;
    releasedBy: string | null;
    releasedById?: number | null;
    releaseNote: string | null;
  }>;
  activities: Array<{
    id: number;
    type: ActivityType;
    title: string;
    details: string | null;
    date: Date;
    actor: string;
    actorId?: number | null;
    product?: string | null;
    pcpNumber?: string | null;
    amount?: number | null;
    amountUnit?: string | null;
    method?: string | null;
  }>;
  attachments: Array<{
    id: number;
    label: string;
    fileName: string;
    category: AttachmentCategory;
    createdAt: Date;
    actor: string;
  }>;
  shipments: Array<{
    shipmentId: number;
    reference: string;
    direction: ShipmentDirection;
    status: ShipmentStatus;
    description: string;
    stateId: number | null;
    at: Date;
    actor: string;
  }>;
  tests: Array<{
    id: number;
    panel: TestPanel;
    analyte: string | null;
    value: number | null;
    uom: string | null;
    wetWeight?: number | null;
    dryWeight?: number | null;
    labName: string | null;
    comment: string | null;
    testedAt: Date;
    createdAt: Date;
    actor: string;
    actorId?: number | null;
  }>;
  incidents: Array<{
    id: number;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    createdAt: Date;
    actor: string;
    actorId?: number | null;
  }>;
  audits: Array<{
    id: number;
    action: string;
    summary: string;
    /** Structured before/after changes, as audited: [{ field, from, to }]. */
    changes?: unknown;
    reason: string | null;
    createdAt: Date;
    actor: string;
  }>;
};

/** The fields an audit entry changed. */
function auditFields(changes: unknown): string[] {
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) =>
    change &&
    typeof change === "object" &&
    typeof (change as { field?: unknown }).field === "string"
      ? [(change as { field: string }).field]
      : []
  );
}

/** The sex before and after, when an audit entry changed it. */
function sexChange(changes: unknown): { from: string | null; to: string | null } | null {
  if (!Array.isArray(changes)) return null;
  const change = changes.find(
    (c) => c && typeof c === "object" && (c as { field?: unknown }).field === "sex"
  ) as { from?: unknown; to?: unknown } | undefined;
  if (!change) return null;
  const value = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return { from: value(change.from), to: value(change.to) };
}

/** Audit actions whose story is already told by an event built from the unit's own records. */
export const COVERED_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  "create",
  "derive",
  "derive_parent",
  "transfer",
  "stage_transition",
  "measure",
  "destroy",
  "activity",
  "attachment",
  "hold",
  "release",
  "lab_test",
  "ship",
]);

/** Filed this long after it happened counts as back-dated: the gap is worth showing. */
const BACKDATED_AFTER_MS = 60_000;

const iso = (date: Date) => date.toISOString();

function recordedAtIfLater(effectiveAt: Date, recordedAt: Date): string | null {
  return recordedAt.getTime() - effectiveAt.getTime() > BACKDATED_AFTER_MS ? iso(recordedAt) : null;
}

type LedgerState = LedgerSource["states"][number];

const isShippedKind = (state: LedgerState) =>
  state.kind === "SHIPPED_PART" || state.kind === "SHIPPED";

/**
 * What a shipment took, against what the unit held before shipping began. The "original" is the amount
 * at the last state that was not itself a shipment (a re-weighing starts a new original), so a unit
 * shipped in three parts reads the same each time: original, this part, shipped so far, left.
 */
function shippedFacts(states: LedgerState[], index: number): LedgerFacts {
  const state = states[index]!;
  const measure =
    state.shippedWeight != null ? "weight" : state.shippedCount != null ? "count" : "whole";
  if (measure === "whole") return { measure };

  const basis = measure === "weight" ? state.shippedMoisture! : null;
  const remainingOf = (s: LedgerState) =>
    measure === "count" ? s.seedCount : basis === "DRY" ? s.dryWeight : s.humidWeight;
  const shippedOf = (s: LedgerState) => (measure === "count" ? s.shippedCount : s.shippedWeight);
  const sameKind = (s: LedgerState) =>
    measure === "count"
      ? s.shippedCount != null
      : s.shippedWeight != null && s.shippedMoisture === basis;

  let totalShipped = shippedOf(state) ?? 0;
  let j = index - 1;
  for (; j >= 0 && isShippedKind(states[j]!); j -= 1) {
    if (sameKind(states[j]!)) totalShipped += shippedOf(states[j]!) ?? 0;
  }
  const before = j >= 0 ? remainingOf(states[j]!) : null;
  return {
    measure,
    basis,
    original: before,
    shipped: shippedOf(state) ?? null,
    totalShipped: Math.round(totalShipped * 1000) / 1000,
    remaining: remainingOf(state),
    final: state.kind === "SHIPPED",
  };
}

function stateEvent(
  source: LedgerSource,
  states: LedgerState[],
  index: number,
  shipmentByStateId: ReadonlyMap<number, LedgerSource["shipments"][number]>
): LedgerEvent[] {
  const state = states[index]!;
  const previous = states[index - 1];
  const base = {
    at: iso(state.effectiveAt),
    recordedAt: recordedAtIfLater(state.effectiveAt, state.recordedAt),
    actor: state.recordedBy,
    actorId: state.recordedById ?? null,
    sequence: state.sequence,
  };
  const make = (
    type: LedgerEvent["type"],
    facts: LedgerFacts,
    note: string | null,
    href?: string,
    suffix = ""
  ): LedgerEvent => ({
    key: `state-${state.id}${suffix}`,
    type,
    ...base,
    facts,
    note,
    ...(href ? { href } : {}),
  });

  const parent = state.parentUnit;
  const events: LedgerEvent[] = [];
  if (state.sequence === 1) {
    events.push(
      make(
        "REGISTERED",
        {
          unitType: source.unit.type,
          cultivar: source.unit.cultivarName,
          experiment: source.unit.experimentCode,
          sourceType: source.unit.sourceType,
        },
        null,
        undefined,
        "-registered"
      )
    );
  }

  switch (state.kind) {
    case "CREATED":
      if (parent) {
        events.push(
          make(
            "DERIVED_FROM",
            { parent: parent.name },
            state.comment,
            `/inventory/units/${parent.id}`,
            "-derived"
          )
        );
      }
      break;
    case "RECEIVED":
      events.push(make("RECEIVED", { organization: state.organizationName }, state.comment));
      if (parent) {
        events.push(
          make(
            "DERIVED_FROM",
            { parent: parent.name },
            null,
            `/inventory/units/${parent.id}`,
            "-derived"
          )
        );
      }
      break;
    case "MOVED":
      events.push(
        make(
          "MOVED",
          {
            from: previous?.locationName ?? null,
            to: state.locationName,
            scanConfirmed: state.scanConfirmed,
          },
          state.comment
        )
      );
      break;
    case "STAGE_CHANGED":
      events.push(
        make(
          "STAGE_CHANGED",
          { from: previous?.growthStage ?? null, to: state.growthStage },
          state.comment
        )
      );
      break;
    case "MEASURED":
      events.push(
        make(
          "MEASURED",
          { humid: state.humidWeight, dry: state.dryWeight, seeds: state.seedCount },
          state.comment
        )
      );
      break;
    case "SHIPPED_PART":
    case "SHIPPED": {
      const shipment = shipmentByStateId.get(state.id);
      events.push(
        make(
          "SHIPPED",
          {
            organization: state.organizationName,
            reference: shipment?.reference ?? null,
            ...shippedFacts(states, index),
          },
          shipment ? null : state.comment,
          shipment ? `/inventory/materials/${shipment.shipmentId}` : undefined
        )
      );
      break;
    }
    case "SAMPLED":
      // What the sample took, on the basis the unit is weighed on, and what is left.
      events.push(
        make(
          "SAMPLED",
          state.shippedCount != null
            ? { measure: "count", taken: state.shippedCount, remaining: state.seedCount }
            : {
                measure: "weight",
                basis: state.shippedMoisture ?? null,
                taken: state.shippedWeight ?? null,
                remaining: state.shippedMoisture === "DRY" ? state.dryWeight : state.humidWeight,
              },
          state.comment
        )
      );
      break;
    case "REGROUPED":
      events.push(make("REGROUPED", { plants: state.plantCount ?? 1 }, state.comment));
      break;
    case "MERGED":
      events.push(make("MERGED", {}, state.comment));
      break;
    case "WASTED":
      events.push(
        make(
          "WASTED",
          {
            wasteType: state.wasteType ?? null,
            basis: state.shippedMoisture ?? null,
            taken: state.shippedWeight ?? null,
            remaining: state.shippedMoisture === "DRY" ? state.dryWeight : state.humidWeight,
          },
          [state.reason, state.comment].filter(Boolean).join(" · ") || null
        )
      );
      break;
    case "DESTROYED":
      events.push(make("DESTROYED", { witness: state.witnessName }, state.reason));
      break;
  }
  return events;
}

export function buildUnitLedger(source: LedgerSource): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  const states = [...source.states].sort((a, b) => a.sequence - b.sequence);
  const first = states[0];
  const shipmentByStateId = new Map(
    source.shipments.flatMap((s) => (s.stateId !== null ? [[s.stateId, s] as const] : []))
  );

  states.forEach((_, index) => {
    events.push(...stateEvent(source, states, index, shipmentByStateId));
  });

  // The parent can also be linked after registration; that is an audited change, not a state.
  const linkAudits = source.audits.filter((a) => a.action === "lineage");
  if (source.unit.sourceParent && !first?.parentStateId) {
    const parent = source.unit.sourceParent;
    for (const audit of linkAudits) {
      events.push({
        key: `audit-${audit.id}`,
        type: "LINEAGE_LINKED",
        at: iso(audit.createdAt),
        recordedAt: null,
        actor: audit.actor,
        sequence: null,
        facts: { parent: parent.name },
        note: null,
        href: `/inventory/units/${parent.id}`,
      });
    }
    if (linkAudits.length === 0 && first) {
      // Linked before audit entries existed (imported data): the registration date is all we know.
      events.push({
        key: "lineage-imported",
        type: "LINEAGE_LINKED",
        at: iso(first.effectiveAt),
        recordedAt: null,
        actor: null,
        sequence: null,
        facts: { parent: parent.name },
        note: null,
        href: `/inventory/units/${parent.id}`,
      });
    }
  }

  for (const child of source.derived) {
    events.push({
      key: `child-${child.id}`,
      type: "PRODUCED",
      at: iso(child.at),
      recordedAt: null,
      actor: child.actor,
      sequence: null,
      facts: { child: child.name },
      note: null,
      href: `/inventory/units/${child.id}`,
    });
  }

  for (const hold of source.holds) {
    events.push({
      key: `hold-${hold.id}`,
      type: "HOLD_PLACED",
      at: iso(hold.placedAt),
      recordedAt: null,
      actor: hold.placedBy,
      actorId: hold.placedById ?? null,
      sequence: null,
      facts: { holdKind: hold.kind, holdOrigin: hold.origin },
      note: hold.reason,
    });
    if (hold.releasedAt) {
      events.push({
        key: `hold-${hold.id}-released`,
        type: "HOLD_RELEASED",
        at: iso(hold.releasedAt),
        recordedAt: null,
        actor: hold.releasedBy,
        actorId: hold.releasedById ?? null,
        sequence: null,
        facts: { holdKind: hold.kind },
        note: hold.releaseNote,
      });
    }
  }

  for (const a of source.activities) {
    events.push({
      key: `activity-${a.id}`,
      type: "ACTIVITY",
      at: iso(a.date),
      recordedAt: null,
      actor: a.actor,
      actorId: a.actorId ?? null,
      sequence: null,
      facts: {
        activityType: a.type,
        title: a.title,
        product: a.product ?? null,
        pcpNumber: a.pcpNumber ?? null,
        amount: a.amount ?? null,
        amountUnit: a.amountUnit ?? null,
        method: a.method ?? null,
      },
      note: a.details,
    });
  }

  for (const a of source.attachments) {
    events.push({
      key: `attachment-${a.id}`,
      type: "ATTACHMENT",
      at: iso(a.createdAt),
      recordedAt: null,
      actor: a.actor,
      sequence: null,
      facts: { label: a.label || a.fileName, category: a.category },
      note: null,
    });
  }

  for (const s of source.shipments) {
    // A shipment line that took from this unit is told by the unit's own shipped event, with a link.
    if (s.stateId !== null && states.some((state) => state.id === s.stateId)) continue;
    events.push({
      key: `shipment-${s.shipmentId}-${s.stateId ?? "line"}`,
      type: "SHIPMENT",
      at: iso(s.at),
      recordedAt: null,
      actor: s.actor,
      sequence: null,
      facts: { reference: s.reference, direction: s.direction, shipmentStatus: s.status },
      note: s.description,
      href: `/inventory/materials/${s.shipmentId}`,
    });
  }

  for (const t of LAB_RESULTS_SHOWN ? source.tests : []) {
    events.push({
      key: `test-${t.id}`,
      type: "TEST",
      at: iso(t.testedAt),
      recordedAt: recordedAtIfLater(t.testedAt, t.createdAt),
      actor: t.actor,
      actorId: t.actorId ?? null,
      sequence: null,
      facts: {
        panel: t.panel,
        analyte: t.analyte,
        value: t.value,
        uom: t.uom,
        wetWeight: t.wetWeight ?? null,
        dryWeight: t.dryWeight ?? null,
        lab: t.labName,
      },
      note: t.comment,
    });
  }

  for (const i of source.incidents) {
    events.push({
      key: `incident-${i.id}`,
      type: "INCIDENT",
      at: iso(i.createdAt),
      recordedAt: null,
      actor: i.actor,
      actorId: i.actorId ?? null,
      sequence: null,
      facts: { severity: i.severity, title: i.title, incidentStatus: i.status },
      note: null,
      href: `/quality/incidents/${i.id}`,
    });
  }

  for (const log of source.audits) {
    if (COVERED_AUDIT_ACTIONS.has(log.action) || log.action === "lineage") continue;
    // A change of sex is part of the unit's story, not a generic edit: it gets its own event.
    const sex = sexChange(log.changes);
    if (log.action === "update" && sex) {
      events.push({
        key: `audit-${log.id}-sex`,
        type: "SEX_CHANGED",
        at: iso(log.createdAt),
        recordedAt: null,
        actor: log.actor,
        sequence: null,
        facts: { from: sex.from, to: sex.to },
        note: null,
      });
      if (auditFields(log.changes).every((field) => field === "sex")) continue;
    }
    events.push({
      key: `audit-${log.id}`,
      type: "AUDIT",
      at: iso(log.createdAt),
      recordedAt: null,
      actor: log.actor,
      sequence: null,
      facts: { action: log.action },
      note: log.summary,
    });
  }

  return events.sort(
    (a, b) =>
      new Date(b.at).getTime() - new Date(a.at).getTime() ||
      (b.sequence ?? 0) - (a.sequence ?? 0) ||
      a.key.localeCompare(b.key)
  );
}
