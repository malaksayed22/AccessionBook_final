import { beforeAll, describe, expect, it, vi } from "vitest";
import { recordActivity } from "@/features/unit/documents";
import {
  getUnitDocuments,
  getUnitLedger,
  getUnitProfile,
  getUnitQuality,
  getUnitStates,
  searchParentCandidates,
} from "@/features/unit/queries";
import { createLab, registerOne, resetDatabase } from "./helpers";

/*
 * Reads are scoped by `unitReadScope`. Today it lets every member see every unit, so this file swaps
 * in the narrower policy the function documents (members see only their experiments' units) to prove
 * that every detail query honours whatever the policy is.
 */
vi.mock("@/server/authz", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/authz")>();
  return {
    ...original,
    unitReadScope: (user: { id: number; permissions: string }) =>
      user.permissions === "ADMIN"
        ? {}
        : { experiment: { members: { some: { userId: user.id } } } },
  };
});

describe("unit detail queries respect the read scope", () => {
  let lab: Awaited<ReturnType<typeof createLab>>;
  let unitId: number;

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    unitId = (await registerOne(lab, { name: "SCOPED-1" })).id;
    await recordActivity(lab.member, unitId, { type: "TREATMENT", title: "Spray" });
  });

  it("shows the unit to a member of its experiment and to an admin", async () => {
    expect((await getUnitProfile(lab.member, unitId))?.name).toBe("SCOPED-1");
    expect((await getUnitProfile(lab.admin, unitId))?.name).toBe("SCOPED-1");
    expect((await getUnitLedger(lab.member, unitId)).length).toBeGreaterThan(0);
  });

  it("hides the unit and everything attached to it from someone outside the experiment", async () => {
    expect(await getUnitProfile(lab.outsider, unitId)).toBeNull();
    expect(await getUnitLedger(lab.outsider, unitId)).toEqual([]);
    expect(await getUnitStates(lab.outsider, unitId)).toEqual([]);
    expect(await getUnitQuality(lab.outsider, unitId)).toEqual({
      tests: [],
      incidents: [],
      holds: [],
      samples: [],
      tissueSamples: [],
    });
    expect(await getUnitDocuments(lab.outsider, unitId)).toEqual({
      attachments: [],
      activities: [],
    });
    expect(await searchParentCandidates(lab.outsider, 0, "scoped")).toEqual([]);
  });
});
