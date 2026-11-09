import "server-only";
import { CapaStatus, IncidentStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { startOfZonedDay } from "@/lib/lab-time";
import { isQuality } from "@/lib/roles";
import { recordAudit, type RequestMeta } from "@/server/audit";
import { assertCanManageIncidents } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import type { CapaCommand } from "./schemas";

/*
 * Corrective and preventive actions (CAPA) on an incident or deviation. Quality assurance raises
 * each action with an owner and a due day; the owner (or quality assurance) records it as done,
 * with what was done; quality assurance then checks that it worked. An incident cannot be closed
 * while one of its actions is still to be done. Every step is in the audit trail.
 */

export async function runCapaCommand(
  actor: SessionUser,
  incidentId: number,
  command: CapaCommand,
  meta?: RequestMeta
) {
  return prisma.$transaction(async (tx) => {
    const incident = await tx.qualityIncident.findUnique({
      where: { id: incidentId },
      select: { id: true, title: true, status: true, voidedAt: true },
    });
    if (!incident || incident.voidedAt) throw errors.notFound("Incident");
    const audit = (action: string, summary: string, reason?: string) =>
      recordAudit(tx, actor, meta, {
        entityType: "incident",
        entityId: incident.id,
        entityLabel: incident.title,
        action,
        summary,
        reason,
      });

    if (command.action === "add") {
      assertCanManageIncidents(actor);
      if (incident.status === IncidentStatus.CLOSED) {
        throw errors.conflict("The incident is closed; reopen it to add an action");
      }
      if (command.ownerId) {
        const owner = await tx.user.findUnique({
          where: { id: command.ownerId },
          select: { active: true, permissions: true },
        });
        if (!owner?.active || owner.permissions === "INSPECTOR") {
          throw errors.validation("Choose an active member", { fields: ["ownerId"] });
        }
      }
      const capa = await tx.capaAction.create({
        data: {
          incidentId: incident.id,
          kind: command.kind,
          description: command.description,
          ownerId: command.ownerId ?? null,
          dueDate: command.dueDate ? startOfZonedDay(command.dueDate, env().LAB_TIMEZONE) : null,
          createdById: actor.id,
        },
        select: { id: true },
      });
      await audit(
        "capa_add",
        `Raised a ${command.kind.toLowerCase()} action: ${command.description}`
      );
      return { capaId: capa.id };
    }

    const capa = await tx.capaAction.findFirst({
      where: { id: command.capaId, incidentId: incident.id },
    });
    if (!capa) throw errors.notFound("Action");

    if (command.action === "complete") {
      if (!isQuality(actor) && capa.ownerId !== actor.id) {
        throw errors.forbidden(
          "Only the action's owner or quality assurance can record it as done"
        );
      }
      if (capa.status !== CapaStatus.OPEN) throw errors.conflict("The action is already done");
      await tx.capaAction.update({
        where: { id: capa.id },
        data: {
          status: CapaStatus.DONE,
          completedAt: new Date(),
          completedById: actor.id,
          completionNote: command.note,
        },
      });
      await audit("capa_complete", `Action done: ${capa.description}`, command.note);
      return { capaId: capa.id };
    }

    assertCanManageIncidents(actor);
    if (capa.status !== CapaStatus.DONE) {
      throw errors.conflict("Only an action that is done can be checked");
    }
    await tx.capaAction.update({
      where: { id: capa.id },
      data: {
        status: CapaStatus.VERIFIED,
        verifiedAt: new Date(),
        verifiedById: actor.id,
        verificationNote: command.note,
      },
    });
    await audit("capa_verify", `Checked the action worked: ${capa.description}`, command.note);
    return { capaId: capa.id };
  });
}
