import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import { detectFileType, MAX_UPLOAD_BYTES, safeDisplayName } from "@/lib/file-types";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanEditExperiment, experimentReadScope, isAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import { storage } from "@/server/storage";
import type { VoidAttachmentInput } from "@/features/unit/schemas";

/**
 * Documents that belong to an experiment as a whole: the protocol, an approval, supplier paperwork.
 * Same rules as unit documents: validated by content, stored privately, downloaded only through an
 * authenticated route, voided (never deleted) with a reason.
 */
const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

type Actor = SessionUser;

export async function uploadExperimentDocument(
  actor: Actor,
  experimentId: number,
  input: { label?: string; fileName: string; bytes: Buffer },
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
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    await assertCanEditExperiment(tx, actor, experimentId);
  }, TRANSACTION);

  const key = `experiments/${experimentId}/${randomUUID()}.${detected.ext}`;
  await storage().put(key, input.bytes);

  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    await assertCanEditExperiment(tx, actor, experimentId);

    const fileName = safeDisplayName(input.fileName);
    const document = await tx.experimentAttachment.create({
      data: {
        experimentId,
        userId: actor.id,
        label: input.label?.trim() || fileName,
        fileName,
        filePath: key,
        mimeType: detected.mime,
        sizeBytes: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
      },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: experiment.ecode,
      action: "attachment",
      summary: `Attached document: ${document.label}`,
      changes: [
        { field: "document", from: null, to: fileName },
        { field: "sha256", from: null, to: document.sha256 },
      ],
    });
    return { documentId: document.id };
  }, TRANSACTION);
}

/** Loads a document for download. Whoever may read the experiment may read its documents. */
export async function readExperimentDocument(
  actor: Actor,
  experimentId: number,
  documentId: number
) {
  const document = await prisma.experimentAttachment.findFirst({
    where: {
      id: documentId,
      experimentId,
      voidedAt: null,
      experiment: experimentReadScope(actor),
    },
  });
  if (!document) throw errors.notFound("Document");
  const body = await storage().get(document.filePath);
  if (!body) throw errors.notFound("Document");
  return { document, body };
}

export async function voidExperimentDocument(
  actor: Actor,
  experimentId: number,
  documentId: number,
  input: VoidAttachmentInput,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUnique({ where: { id: experimentId } });
    if (!experiment) throw errors.notFound("Experiment");
    const document = await tx.experimentAttachment.findFirst({
      where: { id: documentId, experimentId, voidedAt: null },
    });
    if (!document) throw errors.notFound("Document");

    if (!isAdmin(actor)) {
      if (document.userId !== actor.id) {
        throw errors.forbidden("Only the member who attached a document or an admin can remove it");
      }
      await assertCanEditExperiment(tx, actor, experimentId);
    }

    await tx.experimentAttachment.update({
      where: { id: document.id },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason },
    });
    // The stored bytes are kept: removing a document from view must not destroy the evidence.
    await recordAudit(tx, actor, meta, {
      entityType: "experiment",
      entityId: experiment.id,
      entityLabel: experiment.ecode,
      action: "void",
      summary: `Removed document "${document.label}": ${input.reason}`,
      reason: input.reason,
    });
    return { voided: true as const };
  }, TRANSACTION);
}
