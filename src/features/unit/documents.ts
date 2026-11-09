import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { AttachmentCategory } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { detectFileType, MAX_UPLOAD_BYTES, safeDisplayName } from "@/lib/file-types";
import { resolveEffectiveAt } from "@/lib/lab-time";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanEditUnit, isAdmin, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import { storage } from "@/server/storage";
import type { RecordActivityInput, VoidAttachmentInput } from "./schemas";
import { assertActive, assertWithinBackdateLimit, lockUnit, type Tx } from "./state-engine";

/**
 * Notes and documents attached to a unit. Documents are validated by content, stored privately,
 * downloaded only through an authenticated route, and voided (never deleted) with a reason.
 */
const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

type Actor = SessionUser;

export async function recordActivity(
  actor: Actor,
  unitId: number,
  input: RecordActivityInput,
  meta?: RequestMeta
) {
  return prisma.$transaction((tx) => recordActivityTx(tx, actor, unitId, input, meta), TRANSACTION);
}

/**
 * A cultivation activity on one unit: what was done, with what product (and its Pest Control
 * Products Act registration number for a pesticide), how much and how. It may be back-dated, never
 * future-dated. Also used for many units at once (`applyBulk`).
 */
export async function recordActivityTx(
  tx: Tx,
  actor: Actor,
  unitId: number,
  input: RecordActivityInput,
  meta?: RequestMeta
) {
  const unit = await lockUnit(tx, unitId);
  await assertCanEditUnit(tx, actor, unit);
  const current = assertActive(unit);

  const now = new Date();
  const date = input.effectiveAt
    ? resolveEffectiveAt(input.effectiveAt, now, env().LAB_TIMEZONE)
    : now;
  if (!date) throw errors.validation("The date is not valid", { fields: ["effectiveAt"] });
  if (date.getTime() > now.getTime() + 1000) {
    throw errors.rule("activityInFuture", "An activity cannot be dated in the future");
  }
  await assertWithinBackdateLimit(tx, date, now);

  const activity = await tx.unitActivity.create({
    data: {
      unitId: unit.id,
      userId: actor.id,
      stateId: current.id,
      type: input.type,
      title: input.title,
      details: input.details ?? null,
      date,
      product: input.product ?? null,
      pcpNumber: input.pcpNumber ?? null,
      amount: input.amount ?? null,
      amountUnit: input.amountUnit ?? null,
      method: input.method ?? null,
    },
  });
  const applied = [
    input.product,
    input.pcpNumber ? `PCP ${input.pcpNumber}` : null,
    input.amount !== undefined ? `${input.amount} ${input.amountUnit ?? ""}`.trim() : null,
  ].filter(Boolean);
  await recordAudit(tx, actor, meta, {
    entityType: "unit",
    entityId: unit.id,
    entityLabel: unit.name,
    action: "activity",
    summary: `${input.type}: ${input.title}${applied.length ? ` (${applied.join(", ")})` : ""}`,
  });
  return { activityId: activity.id };
}

export async function uploadAttachment(
  actor: Actor,
  unitId: number,
  input: { label: string; category: AttachmentCategory; fileName: string; bytes: Buffer },
  meta?: RequestMeta
) {
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw errors.validation(`Files can be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const detected = detectFileType(input.bytes, input.fileName);
  if (!detected) {
    throw errors.validation("Only PDF, PNG, JPEG, WebP, CSV and plain-text files can be attached");
  }

  // Authorise before touching storage.
  await prisma.$transaction(async (tx) => {
    const unit = await lockUnit(tx, unitId);
    await assertCanEditUnit(tx, actor, unit);
    assertActive(unit);
  }, TRANSACTION);

  const key = `units/${unitId}/${randomUUID()}.${detected.ext}`;
  await storage().put(key, input.bytes);

  return prisma.$transaction(async (tx) => {
    const unit = await lockUnit(tx, unitId);
    await assertCanEditUnit(tx, actor, unit);
    assertActive(unit);

    const attachment = await tx.unitAttachment.create({
      data: {
        unitId: unit.id,
        userId: actor.id,
        label: input.label,
        fileName: safeDisplayName(input.fileName),
        filePath: key,
        mimeType: detected.mime,
        category: input.category,
        sizeBytes: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
      },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "attachment",
      summary: `Attached ${input.category.toLowerCase()}: ${input.label}`,
      changes: [
        { field: "document", from: null, to: safeDisplayName(input.fileName) },
        { field: "sha256", from: null, to: attachment.sha256 },
      ],
    });
    return { attachmentId: attachment.id };
  }, TRANSACTION);
}

/** Loads a document for download. Any signed-in member who may read the unit may read it. */
export async function readAttachment(actor: Actor, unitId: number, attachmentId: number) {
  const attachment = await prisma.unitAttachment.findFirst({
    where: { id: attachmentId, unitId, voidedAt: null, unit: unitReadScope(actor) },
  });
  if (!attachment) throw errors.notFound("Document");
  const body = await storage().get(attachment.filePath);
  if (!body) throw errors.notFound("Document");
  return { attachment, body };
}

export async function voidAttachment(
  actor: Actor,
  unitId: number,
  attachmentId: number,
  input: VoidAttachmentInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const unit = await lockUnit(tx, unitId);
    const attachment = await tx.unitAttachment.findFirst({
      where: { id: attachmentId, unitId, voidedAt: null },
    });
    if (!attachment) throw errors.notFound("Document");

    if (!isAdmin(actor)) {
      if (attachment.userId !== actor.id) {
        throw errors.forbidden("Only the member who attached a document or an admin can remove it");
      }
      await assertCanEditUnit(tx, actor, unit);
      assertActive(unit);
    }

    await tx.unitAttachment.update({
      where: { id: attachment.id },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason },
    });
    // The stored bytes are kept: removing a document from view must not destroy the evidence.
    await recordAudit(tx, actor, meta, {
      entityType: "unit",
      entityId: unit.id,
      entityLabel: unit.name,
      action: "void",
      summary: `Removed document "${attachment.label}": ${input.reason}`,
      reason: input.reason,
    });
    return { voided: true as const };
  }, TRANSACTION);
}
