import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { canRetireLocation } from "@/lib/location-capacity";
import { buildChanges, recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanManageLocations } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { CreateLocationInput, UpdateLocationInput } from "./schemas";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";

/**
 * Storage locations. Admin-only. A location is retired, never deleted: states of past units point at
 * it. It can be retired only while no unit in inventory is stored there, and can be brought back.
 */
type Actor = SessionUser;
type Tx = Prisma.TransactionClient;

async function unitsInside(tx: Tx, locationId: number): Promise<number> {
  return tx.biologicalUnit.count({
    where: {
      currentState: {
        is: { locationId, kind: { notIn: [...NO_STOCK_KINDS] } },
      },
    },
  });
}

async function assertNameFree(tx: Tx, name: string, exceptId?: number) {
  const clash = await tx.location.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (clash) throw errors.conflict(`"${clash.name}" already exists`, { id: clash.id });
}

/** Codes are kept in capitals, whoever calls the service (the form's schema does it too). */
const normalCode = (code: string) => code.trim().toUpperCase();

async function assertCodeFree(tx: Tx, code: string, exceptId?: number) {
  const clash = await tx.location.findFirst({
    where: { code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true, name: true },
  });
  if (clash) {
    throw errors.rule("locationCodeTaken", `The code ${code} is already used by ${clash.name}`, {
      code,
      name: clash.name,
    });
  }
}

/** The next room code: R- and the number after the highest R-number in use, three digits at least. */
async function nextRoomCode(tx: Tx): Promise<string> {
  const used = await tx.location.findMany({
    where: { code: { startsWith: "R-" } },
    select: { code: true },
  });
  const highest = used.reduce((max, { code }) => {
    const match = /^R-(\d+)$/.exec(code ?? "");
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `R-${String(highest + 1).padStart(3, "0")}`;
}

export async function createLocation(actor: Actor, input: CreateLocationInput, meta?: RequestMeta) {
  assertCanManageLocations(actor);
  return prisma.$transaction(async (tx) => {
    await assertNameFree(tx, input.name);
    const code = input.code ? normalCode(input.code) : await nextRoomCode(tx);
    await assertCodeFree(tx, code);
    // Every location is a room: no levels inside it.
    const location = await tx.location.create({
      data: {
        name: input.name,
        code,
        address: input.address || null,
        comment: input.comment || null,
        capacity: input.capacity ?? null,
        capacityMeasure: input.capacityMeasure ?? "UNITS",
        kind: "ROOM",
        parentId: null,
      },
      select: { id: true, name: true },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "location",
      entityId: location.id,
      entityLabel: location.name,
      action: "create",
      summary: `Created location ${location.name}`,
      changes: [
        {
          field: "capacity",
          from: null,
          to: input.capacity == null ? null : String(input.capacity),
        },
        { field: "code", from: null, to: code },
        { field: "address", from: null, to: input.address || null },
        { field: "description", from: null, to: input.comment || null },
        { field: "capacityMeasure", from: null, to: input.capacityMeasure ?? "UNITS" },
      ],
    });
    return location;
  });
}

export async function updateLocation(
  actor: Actor,
  locationId: number,
  input: UpdateLocationInput,
  meta?: RequestMeta
) {
  assertCanManageLocations(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.location.findUnique({ where: { id: locationId } });
    if (!existing) throw errors.notFound("Location");

    const name = input.name ?? existing.name;
    await assertNameFree(tx, name, locationId);
    const newCode = input.code === undefined ? undefined : normalCode(input.code);
    if (newCode !== undefined) await assertCodeFree(tx, newCode, locationId);

    const pick = (value: string | undefined, current: string | null) =>
      value === undefined ? current : value || null;
    const data = {
      name,
      code: newCode ?? existing.code,
      address: pick(input.address, existing.address),
      comment: pick(input.comment, existing.comment),
      capacity: input.capacity === undefined ? existing.capacity : input.capacity,
      capacityMeasure: input.capacityMeasure ?? existing.capacityMeasure,
    };
    const changes = buildChanges([
      { field: "name", from: existing.name, to: data.name },
      { field: "code", from: existing.code, to: data.code },
      { field: "address", from: existing.address, to: data.address },
      { field: "description", from: existing.comment, to: data.comment },
      { field: "capacity", from: existing.capacity, to: data.capacity },
      { field: "capacityMeasure", from: existing.capacityMeasure, to: data.capacityMeasure },
    ]);
    if (changes.length === 0) {
      return { id: existing.id, name: existing.name, unchanged: true as const };
    }

    const location = await tx.location.update({ where: { id: locationId }, data });
    await recordAudit(tx, actor, meta, {
      entityType: "location",
      entityId: location.id,
      entityLabel: location.name,
      action: "update",
      summary: `Updated location ${location.name}`,
      changes,
    });
    return { id: location.id, name: location.name, unchanged: false as const };
  });
}

/**
 * Retires a location. The row is locked and flagged first, then the stock is counted: a unit moved in
 * by a transaction that committed earlier is seen and refuses the retirement (the whole change rolls
 * back).
 */
export async function retireLocation(
  actor: Actor,
  locationId: number,
  input: { reason: string },
  meta?: RequestMeta
) {
  assertCanManageLocations(actor);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${locationId} FOR UPDATE`;
    const location = await tx.location.findUnique({ where: { id: locationId } });
    if (!location) throw errors.notFound("Location");
    if (!location.active) throw errors.conflict(`${location.name} is already retired`);

    await tx.location.update({ where: { id: locationId }, data: { active: false } });
    const inside = await unitsInside(tx, locationId);
    if (!canRetireLocation(inside)) {
      throw errors.locationNotEmpty(location.name, inside);
    }
    await recordAudit(tx, actor, meta, {
      entityType: "location",
      entityId: location.id,
      entityLabel: location.name,
      action: "retire",
      summary: `Retired location ${location.name}`,
      changes: [{ field: "active", from: "true", to: "false" }],
      reason: input.reason,
    });
    return { id: location.id, name: location.name };
  });
}

export async function reactivateLocation(actor: Actor, locationId: number, meta?: RequestMeta) {
  assertCanManageLocations(actor);
  return prisma.$transaction(async (tx) => {
    const location = await tx.location.findUnique({ where: { id: locationId } });
    if (!location) throw errors.notFound("Location");
    if (location.active) throw errors.conflict(`${location.name} is already active`);
    await tx.location.update({ where: { id: locationId }, data: { active: true } });
    await recordAudit(tx, actor, meta, {
      entityType: "location",
      entityId: location.id,
      entityLabel: location.name,
      action: "reactivate",
      summary: `Reactivated location ${location.name}`,
      changes: [{ field: "active", from: "false", to: "true" }],
    });
    return { id: location.id, name: location.name };
  });
}
