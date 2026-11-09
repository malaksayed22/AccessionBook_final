import "server-only";
import type { SessionUser } from "@/lib/auth";
import { buildChanges, recordAudit, type RequestMeta } from "@/server/audit";
import { assertAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import type { UpdateLabSettingsInput } from "./schemas";

/** Saves the laboratory's settings (administrators only), every change in the audit trail. */
export async function updateLabSettings(
  actor: SessionUser,
  input: UpdateLabSettingsInput,
  meta?: RequestMeta
) {
  assertAdmin(actor, "Only admins can change the laboratory's settings");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.labSettings.findUnique({ where: { id: 1 } });
    const pick = <T>(value: T | undefined, current: T) => (value === undefined ? current : value);
    const data = {
      licenceNumber: pick(input.licenceNumber, existing?.licenceNumber ?? null) || null,
      licenceHolder: pick(input.licenceHolder, existing?.licenceHolder ?? null) || null,
      licenceClass: pick(input.licenceClass, existing?.licenceClass ?? null),
      siteAddress: pick(input.siteAddress, existing?.siteAddress ?? null) || null,
      backdateLimitDays: pick(input.backdateLimitDays, existing?.backdateLimitDays ?? null),
      experimentCodePrefix: pick(
        input.experimentCodePrefix,
        existing?.experimentCodePrefix ?? "EXP"
      ),
    };
    const changes = buildChanges([
      { field: "licenceNumber", from: existing?.licenceNumber ?? null, to: data.licenceNumber },
      { field: "licenceHolder", from: existing?.licenceHolder ?? null, to: data.licenceHolder },
      { field: "licenceClass", from: existing?.licenceClass ?? null, to: data.licenceClass },
      { field: "siteAddress", from: existing?.siteAddress ?? null, to: data.siteAddress },
      {
        field: "backdateLimitDays",
        from: existing?.backdateLimitDays ?? null,
        to: data.backdateLimitDays,
      },
      {
        field: "experimentCodePrefix",
        from: existing?.experimentCodePrefix ?? "EXP",
        to: data.experimentCodePrefix,
      },
    ]);
    if (changes.length === 0) return { unchanged: true as const };
    await tx.labSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await recordAudit(tx, actor, meta, {
      entityType: "settings",
      entityId: 1,
      entityLabel: "Laboratory settings",
      action: "update",
      summary: "Updated the laboratory's settings",
      changes,
    });
    return { unchanged: false as const };
  });
}
