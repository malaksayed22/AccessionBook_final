import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { SopVersionStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { isQuality, isReadOnly } from "@/lib/roles";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { CreateSopInput, SopCommand } from "./schemas";

/*
 * Standard operating procedures. The text of a procedure lives in numbered versions: quality
 * assurance writes a draft and approves it, and it takes effect, superseding the version before.
 * Every member then signs that they have read and understood the version in effect; a new version
 * needs new signatures. Approving and signing are electronic signatures: the API asks for the
 * password again first. Everything is in the audit trail.
 */

function assertCanWrite(actor: SessionUser) {
  if (!isQuality(actor)) {
    throw errors.forbidden("Only quality assurance or an admin can write procedures");
  }
}

export async function createSop(actor: SessionUser, input: CreateSopInput, meta?: RequestMeta) {
  assertCanWrite(actor);
  try {
    return await prisma.$transaction(async (tx) => {
      const sop = await tx.sop.create({
        data: {
          code: input.code,
          title: input.title,
          createdById: actor.id,
          versions: { create: { version: 1, body: input.body, createdById: actor.id } },
        },
        select: { id: true, code: true },
      });
      await recordAudit(tx, actor, meta, {
        entityType: "sop",
        entityId: sop.id,
        entityLabel: `${input.code} ${input.title}`,
        action: "create",
        summary: `Drafted ${input.code} version 1`,
      });
      return sop;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw errors.conflict(`${input.code} already exists`, {
        fields: ["code"],
        reason: "sopCodeTaken",
      });
    }
    throw error;
  }
}

export async function updateSop(
  actor: SessionUser,
  sopId: number,
  command: SopCommand,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const sop = await tx.sop.findUnique({
      where: { id: sopId },
      select: {
        id: true,
        code: true,
        title: true,
        versions: {
          orderBy: { version: "desc" },
          select: { id: true, version: true, status: true },
        },
      },
    });
    if (!sop) throw errors.notFound("Procedure");
    const label = `${sop.code} ${sop.title}`;
    const latest = sop.versions[0]!;
    const effective = sop.versions.find((v) => v.status === SopVersionStatus.EFFECTIVE) ?? null;
    const draft = sop.versions.find((v) => v.status === SopVersionStatus.DRAFT) ?? null;

    switch (command.action) {
      case "draft": {
        assertCanWrite(actor);
        if (draft) {
          // One draft at a time: it is rewritten until it is approved.
          await tx.sopVersion.update({
            where: { id: draft.id },
            data: { body: command.body, changeNote: command.changeNote },
          });
        } else {
          await tx.sopVersion.create({
            data: {
              sopId: sop.id,
              version: latest.version + 1,
              body: command.body,
              changeNote: command.changeNote,
              createdById: actor.id,
            },
          });
        }
        const version = draft?.version ?? latest.version + 1;
        await recordAudit(tx, actor, meta, {
          entityType: "sop",
          entityId: sop.id,
          entityLabel: label,
          action: "draft",
          summary: `Drafted ${sop.code} version ${version}`,
          reason: command.changeNote,
        });
        return { version };
      }
      case "approve": {
        assertCanWrite(actor);
        if (!draft) throw errors.conflict("There is no draft to approve");
        const now = new Date();
        if (effective) {
          await tx.sopVersion.update({
            where: { id: effective.id },
            data: { status: SopVersionStatus.SUPERSEDED, supersededAt: now },
          });
        }
        await tx.sopVersion.update({
          where: { id: draft.id },
          data: { status: SopVersionStatus.EFFECTIVE, approvedById: actor.id, approvedAt: now },
        });
        await recordAudit(tx, actor, meta, {
          entityType: "sop",
          entityId: sop.id,
          entityLabel: label,
          action: "approve",
          summary: `Approved ${sop.code} version ${draft.version}; it is now in effect${
            effective ? ` (version ${effective.version} superseded)` : ""
          }`,
        });
        return { version: draft.version };
      }
      case "sign": {
        if (isReadOnly(actor)) throw errors.forbidden("An inspector does not sign procedures");
        if (!effective) throw errors.conflict("No version of this procedure is in effect yet");
        const existing = await tx.sopSignoff.findUnique({
          where: { versionId_userId: { versionId: effective.id, userId: actor.id } },
          select: { id: true },
        });
        if (existing) throw errors.conflict("You have already signed this version");
        await tx.sopSignoff.create({ data: { versionId: effective.id, userId: actor.id } });
        await recordAudit(tx, actor, meta, {
          entityType: "sop",
          entityId: sop.id,
          entityLabel: label,
          action: "sign",
          summary: `Signed ${sop.code} version ${effective.version} as read and understood`,
        });
        return { version: effective.version };
      }
    }
  });
}
