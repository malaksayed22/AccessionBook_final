import { beforeAll, describe, expect, it } from "vitest";
import { GrowthStage } from "@/generated/prisma/enums";
import { getCultivar } from "@/features/cultivar/queries";
import { updateCultivar } from "@/features/cultivar/service";
import { getUnitProfile } from "@/features/unit/queries";
import { changeStage } from "@/features/unit/service";
import { zonedDateKey } from "@/lib/lab-time";
import { prisma } from "@/server/db";
import { createLab, registerOne, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;
const MS_PER_DAY = 86_400_000;

describe("cultivar growth profile", () => {
  let lab: Lab;

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    await updateCultivar(lab.admin, lab.cultivar.id, {
      vegetativeDays: 28,
      floweringDays: 63,
      expectedYieldGrams: 45,
    });
  });

  it("keeps days per stage and the expected yield, audited", async () => {
    expect(await getCultivar(lab.admin, lab.cultivar.id)).toMatchObject({
      vegetativeDays: 28,
      floweringDays: 63,
      expectedYieldGrams: 45,
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "cultivar" } });
    expect(JSON.stringify(entry.details)).toContain("floweringDays");
  });

  it("projects a group's flowering, harvest and yield from when its stage began", async () => {
    const group = await registerOne(lab, {
      name: "GROW-1",
      plantCount: 20,
      growthStage: GrowthStage.VEGETATIVE,
      effectiveAt: zonedDateKey(new Date(Date.now() - 40 * MS_PER_DAY), "America/Toronto"),
    } as never);
    const profile = (await getUnitProfile(lab.member, group.id))!;
    const since = profile.stageDurations.current!.start.getTime();
    expect(profile.projection).toEqual({
      floweringOn: new Date(since + 28 * MS_PER_DAY),
      harvestOn: new Date(since + (28 + 63) * MS_PER_DAY),
      expectedYieldGrams: 900,
    });

    const tenDaysAgo = zonedDateKey(new Date(Date.now() - 10 * MS_PER_DAY), "America/Toronto");
    await changeStage(lab.member, group.id, { toStage: "FLOWERING", effectiveAt: tenDaysAgo });
    const flowering = (await getUnitProfile(lab.member, group.id))!;
    const began = flowering.stageDurations.current!.start.getTime();
    expect(flowering.projection).toMatchObject({
      floweringOn: null,
      harvestOn: new Date(began + 63 * MS_PER_DAY),
    });
  });
});
