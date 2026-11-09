import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import { detectFileType, MAX_UPLOAD_BYTES, safeDisplayName } from "@/lib/file-types";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import { storage } from "@/server/storage";

/**
 * Documents filed with an organization: its licence, an agreement, supplier or laboratory paperwork.
 * Like the other documents: validated by content, stored privately, downloaded only through an
 * authenticated route. Administrators add them (they manage organizations); anyone signed in who can
 * open the organization can download them.
 */
const TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

export async function uploadOrganizationDocument(
  actor: SessionUser,
  organizationId: number,
  input: { label?: string; fileName: string; bytes: Buffer },
  meta?: RequestMeta
) {
  assertAdmin(actor, "Only admins can add documents to an organization");
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw errors.validation(`Files can be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const detected = detectFileType(input.bytes, input.fileName);
  if (!detected) {
    throw errors.validation("Only PDF, PNG, JPEG, WebP, CSV and plain-text files can be attached");
  }
  const exists = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!exists) throw errors.notFound("Organization");

  const key = `organizations/${organizationId}/${randomUUID()}.${detected.ext}`;
  await storage().put(key, input.bytes);

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw errors.notFound("Organization");

    const fileName = safeDisplayName(input.fileName);
    const document = await tx.organizationAttachment.create({
      data: {
        organizationId,
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
      entityType: "organization",
      entityId: organization.id,
      entityLabel: organization.name,
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

/** Loads a document for download. */
export async function readOrganizationDocument(
  _actor: SessionUser,
  organizationId: number,
  documentId: number
) {
  const document = await prisma.organizationAttachment.findFirst({
    where: { id: documentId, organizationId },
  });
  if (!document) throw errors.notFound("Document");
  const body = await storage().get(document.filePath);
  if (!body) throw errors.notFound("Document");
  return { document, body };
}
