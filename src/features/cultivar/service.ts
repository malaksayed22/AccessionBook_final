import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { buildChanges, recordAudit, type RequestMeta } from "@/server/audit";
import { assertAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { CreateCultivarInput, UpdateCultivarInput } from "./schemas";

/**
 * The genetic library. Admin-only: units, tests and shipments point at a cultivar, so its identity
 * (name, code) is changed deliberately and every change is audited with before and after.
 */
type Actor = SessionUser;
type Tx = Prisma.TransactionClient;

async function assertNameFree(tx: Tx, name: string, exceptId?: number) {
  const clash = await tx.cultivar.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (clash) throw errors.conflict(`"${clash.name}" is already in the library`, { id: clash.id });
}

export async function createCultivar(actor: Actor, input: CreateCultivarInput, meta?: RequestMeta) {
  assertAdmin(actor, "Only admins can manage the genetic library");
  return prisma.$transaction(async (tx) => {
    await assertNameFree(tx, input.name);
    const cultivar = await tx.cultivar.create({
      data: {
        name: input.name,
        commonName: input.commonName || null,
        category: input.category || null,
        targetThc: input.targetThc ?? null,
        targetCbd: input.targetCbd ?? null,
        vegetativeDays: input.vegetativeDays ?? null,
        floweringDays: input.floweringDays ?? null,
        expectedYieldGrams: input.expectedYieldGrams ?? null,
        comment: input.comment || null,
      },
      select: { id: true, name: true, code: true },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "cultivar",
      entityId: cultivar.id,
      entityLabel: cultivar.name,
      action: "create",
      summary: `Added cultivar ${cultivar.name} to the genetic library`,
      changes: [
        { field: "code", from: null, to: cultivar.code },
        {
          field: "targetThc",
          from: null,
          to: input.targetThc == null ? null : String(input.targetThc),
        },
        {
          field: "targetCbd",
          from: null,
          to: input.targetCbd == null ? null : String(input.targetCbd),
        },
      ],
    });
    return cultivar;
  });
}

export async function updateCultivar(
  actor: Actor,
  cultivarId: number,
  input: UpdateCultivarInput,
  meta?: RequestMeta
) {
  assertAdmin(actor, "Only admins can manage the genetic library");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.cultivar.findUnique({ where: { id: cultivarId } });
    if (!existing) throw errors.notFound("Cultivar");

    const name = input.name ?? existing.name;
    await assertNameFree(tx, name, cultivarId);

    const pick = (value: string | undefined, current: string | null) =>
      value === undefined ? current : value || null;
    const pickNumber = (value: number | null | undefined, current: number | null) =>
      value === undefined ? current : value;
    const data = {
      name,
      commonName: pick(input.commonName, existing.commonName),
      category: pick(input.category, existing.category),
      targetThc: pickNumber(input.targetThc, existing.targetThc),
      targetCbd: pickNumber(input.targetCbd, existing.targetCbd),
      vegetativeDays: pickNumber(input.vegetativeDays, existing.vegetativeDays),
      floweringDays: pickNumber(input.floweringDays, existing.floweringDays),
      expectedYieldGrams: pickNumber(input.expectedYieldGrams, existing.expectedYieldGrams),
      comment: pick(input.comment, existing.comment),
    };
    const changes = buildChanges([
      { field: "name", from: existing.name, to: data.name },
      { field: "commonName", from: existing.commonName, to: data.commonName },
      { field: "category", from: existing.category, to: data.category },
      { field: "targetThc", from: existing.targetThc, to: data.targetThc },
      { field: "targetCbd", from: existing.targetCbd, to: data.targetCbd },
      { field: "vegetativeDays", from: existing.vegetativeDays, to: data.vegetativeDays },
      { field: "floweringDays", from: existing.floweringDays, to: data.floweringDays },
      {
        field: "expectedYieldGrams",
        from: existing.expectedYieldGrams,
        to: data.expectedYieldGrams,
      },
      { field: "comment", from: existing.comment, to: data.comment },
    ]);
    if (changes.length === 0) {
      return { id: existing.id, name: existing.name, unchanged: true as const };
    }

    const cultivar = await tx.cultivar.update({ where: { id: cultivarId }, data });
    await recordAudit(tx, actor, meta, {
      entityType: "cultivar",
      entityId: cultivar.id,
      entityLabel: cultivar.name,
      action: "update",
      summary: `Updated cultivar ${cultivar.name}`,
      changes,
    });
    return { id: cultivar.id, name: cultivar.name, unchanged: false as const };
  });
}
