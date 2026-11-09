import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  MaterialClass,
  Measure,
  Moisture,
  ShipmentDirection,
  ShipmentStatus,
  UnitStateKind,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { resolveEffectiveAt } from "@/lib/lab-time";
import {
  buildShipmentReference,
  isWeightBased,
  measureForMaterial,
  summarizeTotals,
  sumMaterials,
  validateShipmentItem,
} from "@/lib/materials";
import { buildChanges, recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanManageShipments } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import {
  appendState,
  assertActive,
  assertNotOnHold,
  lockUnit,
  type StatePatch,
  type Tx,
} from "@/features/unit/state-engine";
import type { CreateShipmentInput, ShipmentItemInput, UpdateShipmentInput } from "./schemas";

/**
 * Shipments are custody records AND inventory events. An outbound shipment that leaves
 * (IN_TRANSIT or DELIVERED) writes a SHIPPED state for every unit it lists, in the same
 * transaction, so the register and the inventory can never disagree. Inbound receipts record
 * the counterparty and quantities; received material is registered as units with provenance.
 */
const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

type Actor = SessionUser;

/** Allowed status moves. A shipment that has left cannot be un-shipped: returns are new receipts. */
const NEXT_STATUS: Record<ShipmentStatus, ReadonlySet<ShipmentStatus>> = {
  DRAFT: new Set([ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED]),
  IN_TRANSIT: new Set([ShipmentStatus.DELIVERED]),
  DELIVERED: new Set(),
  CANCELLED: new Set(),
};

function departs(status: ShipmentStatus) {
  return status === ShipmentStatus.IN_TRANSIT || status === ShipmentStatus.DELIVERED;
}

function resolveDate(value: string | undefined, now: Date): Date | null {
  if (value === undefined) return null;
  const date = resolveEffectiveAt(value, now, env().LAB_TIMEZONE);
  if (!date) throw errors.validation("A date is not valid");
  return date;
}

/** Normalises a line to its regulatory accounting basis: counts never store grams and vice versa. */
function normalizeItem(item: ShipmentItemInput) {
  const measure = measureForMaterial(item.materialType) as Measure;
  const weighed = measure === Measure.WEIGHT;
  const normalized = {
    description: item.description,
    materialType: item.materialType,
    measure,
    unitId: item.unitId ?? null,
    cultivarId: item.cultivarId ?? null,
    unitCount: weighed ? null : (item.unitCount ?? null),
    weightGrams: weighed ? (item.weightGrams ?? null) : null,
    moisture: weighed ? (item.moisture ?? null) : null,
    comment: item.comment ?? null,
    isPart: item.unitId ? item.isPart === true : false,
  };
  const result = validateShipmentItem({
    materialType: normalized.materialType,
    unitCount: normalized.unitCount,
    weightGrams: normalized.weightGrams,
    moisture: normalized.moisture,
  });
  if (!result.ok) throw errors.validation(result.error);
  return normalized;
}

async function allocateReference(tx: Tx, direction: ShipmentDirection): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = buildShipmentReference(direction);
    const clash = await tx.shipment.findUnique({
      where: { reference: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw errors.conflict("Could not allocate a unique shipment reference — please retry");
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * What shipping this line takes from the unit, and what it leaves. A flower ships grams on a wet or dry
 * basis and a seed lot ships seeds, so part of it can leave and the rest stays in inventory. A plant
 * or a culture is one whole organism: it ships whole. Taking everything that is left ends the unit's
 * stock (the event is SHIPPED); taking less leaves the unit active (SHIPPED_PART).
 */
function planShipment(
  unit: { name: string; type: string },
  state: { humidWeight: unknown; dryWeight: unknown; seedCount: number | null },
  item: {
    weightGrams: unknown;
    unitCount: number | null;
    moisture: Moisture | null;
    materialType: MaterialClass;
    isPart: boolean;
  }
): { kind: UnitStateKind; patch: StatePatch; before: string; after: string } {
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const material = item.materialType;
  const weighedPart = material === MaterialClass.FLOWER || material === MaterialClass.TRIM;
  const weighed = num(state.humidWeight) !== null || num(state.dryWeight) !== null;

  // Flower or trim comes out of the weight of a flower, or of a plant that was harvested and
  // weighed (as a part). Seeds come out of a counted seed lot.
  const fromWeight =
    (unit.type === "FLOWER" && (weighedPart || !item.isPart)) ||
    (item.isPart && unit.type === "PLANT" && weighedPart && weighed);
  const fromSeeds =
    unit.type === "SEEDLOT" &&
    state.seedCount !== null &&
    (material === MaterialClass.SEED || !item.isPart);
  // Anything else named as a part (clones or tissue from a plant, seeds from a flower) leaves the
  // unit's own stock as it was.
  if (item.isPart && !fromWeight && !fromSeeds) return planOtherPart(unit, item);

  if (fromWeight) {
    const basis = item.moisture;
    const shipped = num(item.weightGrams);
    if (!basis || shipped === null || shipped <= 0) {
      throw errors.rule(
        "gramsRequired",
        `Enter how many grams of ${unit.name} are shipped, wet or dry`,
        { unit: unit.name }
      );
    }
    // Once a dry weight is recorded the flower is dried cannabis: it ships, and is reported to
    // Health Canada, by dry weight.
    if (basis === Moisture.WET && num(state.dryWeight) !== null) {
      throw errors.rule("driedShipsDry", `${unit.name} has a dry weight: ship it by dry weight`, {
        unit: unit.name,
      });
    }
    const basisWord = basis === Moisture.DRY ? "dry" : "wet";
    const left = num(basis === Moisture.DRY ? state.dryWeight : state.humidWeight);
    if (left === null) {
      throw errors.rule(
        basis === Moisture.DRY ? "noDryWeightToShip" : "noWetWeightToShip",
        `${unit.name} has no recorded ${basisWord} weight to ship from. Record a weight on the unit first.`,
        { unit: unit.name, basis: basisWord }
      );
    }
    if (shipped > left + 0.0005) {
      throw errors.rule(
        basis === Moisture.DRY ? "moreThanLeftDry" : "moreThanLeftWet",
        `Only ${left} g (${basisWord}) of ${unit.name} is left; ${shipped} g is more than that`,
        { unit: unit.name, basis: basisWord, left, shipped }
      );
    }
    const rest = round3(Math.max(left - shipped, 0));
    const final = rest <= 0;
    const otherKey = basis === Moisture.DRY ? "humidWeight" : "dryWeight";
    const patch: StatePatch = {
      shippedWeight: shipped,
      shippedMoisture: basis,
      [basis === Moisture.DRY ? "dryWeight" : "humidWeight"]: rest,
      // Nothing left means nothing left on either basis, but a basis that was never weighed stays
      // unrecorded rather than appearing as a measured 0 g.
      ...(final && num(state[otherKey]) !== null ? { [otherKey]: 0 } : {}),
    };
    return {
      kind: final ? UnitStateKind.SHIPPED : UnitStateKind.SHIPPED_PART,
      patch,
      before: `${left} g`,
      after: `${rest} g`,
    };
  }

  if (fromSeeds && state.seedCount !== null) {
    const shipped = item.unitCount;
    if (shipped === null || !Number.isInteger(shipped) || shipped <= 0) {
      throw errors.rule("seedsRequired", `Enter how many seeds of ${unit.name} are shipped`, {
        unit: unit.name,
      });
    }
    if (shipped > state.seedCount) {
      throw errors.rule(
        "seedsMoreThanLeft",
        `Only ${state.seedCount} seeds of ${unit.name} are left; ${shipped} is more than that`,
        { unit: unit.name, left: state.seedCount, shipped }
      );
    }
    const rest = state.seedCount - shipped;
    return {
      kind: rest === 0 ? UnitStateKind.SHIPPED : UnitStateKind.SHIPPED_PART,
      patch: { shippedCount: shipped, seedCount: rest },
      before: `${state.seedCount} seeds`,
      after: `${rest} seeds`,
    };
  }

  // A plant, a culture, or a seed lot whose count was never recorded: it ships whole.
  return { kind: UnitStateKind.SHIPPED, patch: {}, before: "all", after: "none" };
}

/**
 * A part of another kind than the unit's own stock: clones or cuttings taken from a plant, seeds
 * collected from a flower, tissue from a plant. It leaves on the shipment, linked to the unit it came
 * from for traceability, and the unit's own stock (its weight or seed count) does not change.
 */
function planOtherPart(
  unit: { name: string },
  item: {
    weightGrams: unknown;
    unitCount: number | null;
    moisture: Moisture | null;
    materialType: MaterialClass;
  }
): { kind: UnitStateKind; patch: StatePatch; before: string; after: string } {
  if (isWeightBased(item.materialType)) {
    const shipped = item.weightGrams === null ? null : Number(item.weightGrams);
    if (!item.moisture || shipped === null || !(shipped > 0)) {
      throw errors.rule(
        "gramsRequired",
        `Enter how many grams of ${unit.name} are shipped, wet or dry`,
        { unit: unit.name }
      );
    }
    return {
      kind: UnitStateKind.SHIPPED_PART,
      patch: { shippedWeight: shipped, shippedMoisture: item.moisture },
      before: "unchanged",
      after: "unchanged",
    };
  }
  const shipped = item.unitCount;
  if (shipped === null || !Number.isInteger(shipped) || shipped <= 0) {
    throw errors.rule("countRequired", `Enter how many are shipped from ${unit.name}`, {
      unit: unit.name,
    });
  }
  return {
    kind: UnitStateKind.SHIPPED_PART,
    patch: { shippedCount: shipped },
    before: "unchanged",
    after: "unchanged",
  };
}

/**
 * Takes what each line of an outbound shipment names from its unit. All or nothing: one line that asks
 * for more than is left, or for a unit that is on hold, stops the whole shipment.
 */
async function shipUnits(
  tx: Tx,
  actor: Actor,
  meta: RequestMeta | undefined,
  shipment: { id: number; reference: string; organizationId: number },
  items: Array<{
    id: number;
    unitId: number | null;
    stateId: number | null;
    weightGrams: unknown;
    unitCount: number | null;
    moisture: Moisture | null;
    materialType: MaterialClass;
    isPart: boolean;
  }>,
  effectiveAt: Date
) {
  const seen = new Set<number>();
  for (const item of items) {
    if (item.unitId === null || item.stateId !== null) continue;
    // A unit appears once when all of it ships; several parts of it (flower, trim, seeds) may each
    // have their own line, taken one after the other.
    const partsOnly = items.filter((i) => i.unitId === item.unitId).every((i) => i.isPart);
    if (seen.has(item.unitId) && !partsOnly) {
      throw errors.conflict("A unit can appear on a shipment only once");
    }
    seen.add(item.unitId);

    const unit = await lockUnit(tx, item.unitId);
    const current = assertActive(unit);
    assertNotOnHold(unit);
    const plan = planShipment(unit, current, item);
    const state = await appendState(
      tx,
      actor,
      unit,
      plan.kind,
      {
        ...plan.patch,
        organizationId: shipment.organizationId,
        comment: `Shipment ${shipment.reference}`,
      },
      effectiveAt
    );
    await tx.shipmentItem.update({ where: { id: item.id }, data: { stateId: state.id } });
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "ship",
      summary:
        plan.kind === UnitStateKind.SHIPPED
          ? `Shipped on ${shipment.reference}; nothing left`
          : plan.after === "unchanged"
            ? `Shipped a part of another kind on ${shipment.reference}; stock unchanged`
            : `Shipped part on ${shipment.reference}; ${plan.after} left`,
      changes: [{ field: "left in stock", from: plan.before, to: plan.after }],
    });
  }
}

async function requireOrganization(tx: Tx, organizationId: number) {
  const organization = await tx.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw errors.notFound("Organization");
  return organization;
}

export async function createShipment(actor: Actor, input: CreateShipmentInput, meta?: RequestMeta) {
  assertCanManageShipments(actor);
  const items = input.items.map(normalizeItem);
  const status = input.status ?? ShipmentStatus.DRAFT;
  const now = new Date();
  const shippedDate = resolveDate(input.shippedDate, now);
  const deliveredDate = resolveDate(input.deliveredDate, now);

  return prisma.$transaction(async (tx) => {
    const organization = await requireOrganization(tx, input.organizationId);
    if (items.some((i) => i.unitId !== null) && input.direction === ShipmentDirection.INBOUND) {
      throw errors.validation(
        "Received lines cannot reference units: register received material as units"
      );
    }
    // A shipped line that names no unit would leave inventory unchanged and break reconciliation.
    // Trim is the exception: it is weighed material that is not tracked as a unit.
    if (
      input.direction === ShipmentDirection.OUTBOUND &&
      items.some((i) => i.unitId === null && i.materialType !== MaterialClass.TRIM)
    ) {
      throw errors.rule(
        "outboundNeedsUnit",
        "Every shipped line must be a unit from inventory, so stock goes down with it; only trim may be a free line"
      );
    }

    const shipment = await tx.shipment.create({
      data: {
        reference: await allocateReference(tx, input.direction),
        direction: input.direction,
        status,
        organizationId: organization.id,
        userId: actor.id,
        shippedDate:
          shippedDate ?? (departs(status) && input.direction === "OUTBOUND" ? now : null),
        deliveredDate: deliveredDate ?? (status === ShipmentStatus.DELIVERED ? now : null),
        trackingNumber: input.trackingNumber ?? null,
        licenceNumber: input.licenceNumber ?? organization.licenceNumber,
        comment: input.comment ?? null,
        items: { create: items },
      },
      include: { items: true },
    });

    if (input.direction === ShipmentDirection.OUTBOUND && departs(status)) {
      await shipUnits(tx, actor, meta, shipment, shipment.items, shippedDate ?? now);
    }

    await recordAudit(tx, actor, meta, {
      entityType: "shipment",
      entityId: shipment.id,
      entityLabel: shipment.reference,
      action: "create",
      summary: `${input.direction === "INBOUND" ? "Received from" : "Shipped to"} ${organization.name} — ${summarizeTotals(
        sumMaterials(items)
      )} (${status})`,
      changes: [
        { field: "status", from: null, to: status },
        { field: "lines", from: null, to: String(items.length) },
      ],
    });
    return { id: shipment.id, reference: shipment.reference, status };
  }, TRANSACTION);
}

export async function updateShipment(
  actor: Actor,
  shipmentId: number,
  input: UpdateShipmentInput,
  meta?: RequestMeta
) {
  assertCanManageShipments(actor);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Serialise concurrent status changes on the same shipment.
    await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId} FOR UPDATE`;
    const existing = await tx.shipment.findUnique({
      where: { id: shipmentId },
      include: { items: true },
    });
    if (!existing || existing.voidedAt) throw errors.notFound("Shipment");

    const nextStatus = input.status ?? existing.status;
    if (nextStatus !== existing.status && !NEXT_STATUS[existing.status].has(nextStatus)) {
      throw errors.conflict(
        `A ${existing.status.toLowerCase()} shipment cannot become ${nextStatus.toLowerCase()}`
      );
    }

    const text = (value: string | undefined, current: string | null) =>
      value === undefined ? current : value || null;
    const shippedDate =
      input.shippedDate !== undefined ? resolveDate(input.shippedDate, now) : existing.shippedDate;
    let deliveredDate =
      input.deliveredDate !== undefined
        ? resolveDate(input.deliveredDate, now)
        : existing.deliveredDate;
    // Marking delivered without a date would leave the custody chain open-ended.
    if (nextStatus === ShipmentStatus.DELIVERED && !deliveredDate) deliveredDate = now;

    const leaving =
      existing.direction === ShipmentDirection.OUTBOUND &&
      !departs(existing.status) &&
      departs(nextStatus);
    const effectiveShipped = shippedDate ?? (leaving ? now : null);

    const updated = await tx.shipment.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        shippedDate: effectiveShipped,
        deliveredDate,
        trackingNumber: text(input.trackingNumber, existing.trackingNumber),
        licenceNumber: text(input.licenceNumber, existing.licenceNumber),
        comment: text(input.comment, existing.comment),
      },
    });

    if (leaving) {
      await shipUnits(tx, actor, meta, existing, existing.items, effectiveShipped ?? now);
    }

    const changes = buildChanges([
      { field: "status", from: existing.status, to: updated.status },
      {
        field: "shippedDate",
        from: existing.shippedDate?.toISOString(),
        to: updated.shippedDate?.toISOString(),
      },
      {
        field: "deliveredDate",
        from: existing.deliveredDate?.toISOString(),
        to: updated.deliveredDate?.toISOString(),
      },
      { field: "trackingNumber", from: existing.trackingNumber, to: updated.trackingNumber },
      { field: "licenceNumber", from: existing.licenceNumber, to: updated.licenceNumber },
      { field: "comment", from: existing.comment, to: updated.comment },
    ]);
    if (changes.length === 0) return { unchanged: true as const, status: existing.status };

    await recordAudit(tx, actor, meta, {
      entityType: "shipment",
      entityId: existing.id,
      entityLabel: existing.reference,
      action: "update",
      summary: `Updated shipment ${existing.reference}: ${changes.map((c) => c.field).join(", ")}`,
      changes,
    });
    return { unchanged: false as const, status: updated.status };
  }, TRANSACTION);
}

export async function voidShipment(
  actor: Actor,
  shipmentId: number,
  input: { reason: string },
  meta?: RequestMeta
) {
  assertCanManageShipments(actor);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId} FOR UPDATE`;
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment || shipment.voidedAt) throw errors.notFound("Shipment");
    if (departs(shipment.status)) {
      throw errors.conflict("A shipment that has left or been received cannot be voided");
    }
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "shipment",
      entityId: shipment.id,
      entityLabel: shipment.reference,
      action: "void",
      summary: `Voided shipment ${shipment.reference}: ${input.reason}`,
      reason: input.reason,
    });
    return { voided: true as const };
  }, TRANSACTION);
}

/**
 * Inbound receipt written alongside the experiment intake: one line per registered unit, linked to
 * the unit's RECEIVED state so traceability stays one-to-one. Runs inside the caller's transaction.
 */
export async function createIntakeReceipt(
  tx: Tx,
  actor: Actor,
  input: {
    organizationId: number;
    experimentCode: string;
    licenceNumber: string | null;
    deliveredDate: Date;
    items: Array<
      Omit<Prisma.ShipmentItemUncheckedCreateInput, "shipmentId"> & {
        materialType: MaterialClass;
        measure: Measure;
        moisture?: Moisture | null;
      }
    >;
  }
) {
  return tx.shipment.create({
    data: {
      reference: await allocateReference(tx, ShipmentDirection.INBOUND),
      direction: ShipmentDirection.INBOUND,
      status: ShipmentStatus.DELIVERED,
      organizationId: input.organizationId,
      userId: actor.id,
      deliveredDate: input.deliveredDate,
      licenceNumber: input.licenceNumber,
      comment: `Material receipt linked to experiment ${input.experimentCode}`,
      items: { create: input.items },
    },
    select: { id: true, reference: true },
  });
}
