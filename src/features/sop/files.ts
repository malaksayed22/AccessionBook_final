import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { SopVersionStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { detectFileType, MAX_UPLOAD_BYTES, safeDisplayName } from "@/lib/file-types";
import { isQuality } from "@/lib/roles";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import { storage } from "@/server/storage";

/*
 * A procedure version's controlled document, as the lab keeps it (PDF or Word). It is attached to
 * the draft and frozen with it once approved: a version in effect never changes, so a new document
 * means a new version. Files are checked by content, stored privately and downloaded only through
 * an authenticated route.
 */

const DOCUMENT_TYPES = new Set(["pdf", "docx"]);

export async function attachSopFile(
  actor: SessionUser,
  sopId: number,
  input: { fileName: string; bytes: Buffer },
  meta?: RequestMeta
) {
  if (!isQuality(actor)) {
    throw errors.forbidden("Only quality assurance or an admin can write procedures");
  }
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw errors.validation(`Files can be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const detected = detectFileType(input.bytes, input.fileName);
  if (!detected || !DOCUMENT_TYPES.has(detected.ext)) {
    throw errors.rule("sopFileType", "Attach the procedure as a PDF or Word document");
  }
  const draft = await prisma.sopVersion.findFirst({
    where: { sopId, status: SopVersionStatus.DRAFT },
    select: { id: true, version: true, sop: { select: { code: true, title: true } } },
  });
  if (!draft) {
    throw errors.rule("sopNoDraft", "Draft a new version first: a version in effect never changes");
  }

  const key = `sops/${sopId}/v${draft.version}-${randomUUID()}.${detected.ext}`;
  await storage().put(key, input.bytes);
  const fileName = safeDisplayName(input.fileName);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  return prisma.$transaction(async (tx) => {
    // Still the draft: approval may have happened while the bytes were being stored.
    const current = await tx.sopVersion.findFirst({
      where: { id: draft.id, status: SopVersionStatus.DRAFT },
      select: { id: true },
    });
    if (!current) throw errors.conflict("The draft was approved meanwhile; draft a new version");
    await tx.sopVersion.update({
      where: { id: draft.id },
      data: {
        fileName,
        filePath: key,
        fileMime: detected.mime,
        fileSize: input.bytes.length,
        fileSha256: sha256,
      },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "sop",
      entityId: sopId,
      entityLabel: `${draft.sop.code} ${draft.sop.title}`,
      action: "attachment",
      summary: `Attached ${fileName} to ${draft.sop.code} version ${draft.version}`,
      changes: [
        { field: "document", from: null, to: fileName },
        { field: "sha256", from: null, to: sha256 },
      ],
    });
    return { version: draft.version };
  });
}

/** The document of one version, for download. Every signed-in member may read procedures. */
export async function readSopFile(sopId: number, version: number) {
  const row = await prisma.sopVersion.findUnique({
    where: { sopId_version: { sopId, version } },
    select: { fileName: true, filePath: true, fileMime: true },
  });
  if (!row?.filePath || !row.fileName) throw errors.notFound("Document");
  const body = await storage().get(row.filePath);
  if (!body) throw errors.notFound("Document");
  return { fileName: row.fileName, mime: row.fileMime ?? "application/octet-stream", body };
}
