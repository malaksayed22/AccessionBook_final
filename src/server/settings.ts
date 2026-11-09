import "server-only";
import type { LicenceClass } from "@/generated/prisma/enums";
import { prisma } from "./db";
import { env } from "./env";

/**
 * The laboratory's settings, with their defaults: the licence number falls back to LAB_LICENSE_ID,
 * the code prefix to EXP, and no back-dating limit. Read where they apply, so a change takes effect
 * on the next request.
 */
export type LabSettingsView = {
  licenceNumber: string | null;
  licenceHolder: string | null;
  licenceClass: LicenceClass | null;
  siteAddress: string | null;
  backdateLimitDays: number | null;
  experimentCodePrefix: string;
};

type Db = Pick<typeof prisma, "labSettings">;

export async function getLabSettings(db: Db = prisma): Promise<LabSettingsView> {
  const row = await db.labSettings.findUnique({ where: { id: 1 } });
  return {
    licenceNumber: row?.licenceNumber || env().LAB_LICENSE_ID || null,
    licenceHolder: row?.licenceHolder ?? null,
    licenceClass: row?.licenceClass ?? null,
    siteAddress: row?.siteAddress ?? null,
    backdateLimitDays: row?.backdateLimitDays ?? null,
    experimentCodePrefix: row?.experimentCodePrefix || "EXP",
  };
}
