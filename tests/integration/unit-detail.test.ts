import { beforeAll, describe, expect, it, vi } from "vitest";
import { HoldKind, IncidentSeverity, TestPanel } from "@/generated/prisma/enums";
import { openIncident, placeHold, recordLabTest, releaseHold } from "@/features/qa/service";
import { recordActivity, uploadAttachment, voidAttachment } from "@/features/unit/documents";
import {
  getUnitDocuments,
  getUnitLedger,
  getUnitProfile,
  getUnitQuality,
  getUnitStates,
  searchParentCandidates,
} from "@/features/unit/queries";
import {
  changeStage,
  deriveUnits,
  linkParent,
  measureUnit,
  moveUnit,
} from "@/features/unit/service";
import { zonedDateKey } from "@/lib/lab-time";
import { createLab, registerOne, resetDatabase } from "./helpers";

// Uploads go to memory, not to the development disk.
vi.mock("@/server/storage", () => {
  const files = new Map<string, Buffer>();
  return {
    storage: () => ({
      put: async (key: string, data: Buffer) => void files.set(key, data),
      get: async (key: string) => files.get(key) ?? null,
    }),
  };
});

process.env.LAB_TIMEZONE = "America/Toronto";
const MS_PER_DAY = 86_400_000;
const dayKey = (daysAgo: number) =>
  zonedDateKey(new Date(Date.now() - daysAgo * MS_PER_DAY), "America/Toronto");

type Lab = Awaited<ReturnType<typeof createLab>>;

describe("unit detail queries", () => {
  let lab: Lab;
  let unitId: number;
  let childId: number;

  beforeAll(async () => {
    await resetDatabase();
    lab = await createLab();
    // Registered ten days ago, then every kind of event, one of them back-dated.
    unitId = (await registerOne(lab, { name: "DETAIL-1", effectiveAt: dayKey(10) })).id;
    await changeStage(lab.member, unitId, {
      toStage: "FLOWERING",
      effectiveAt: dayKey(5),
      comment: "late entry",
    });
    await moveUnit(lab.member, unitId, { toLocationId: lab.rooms[1].id }, { requireScan: false });
    await measureUnit(lab.member, unitId, { humidWeight: 12.5, dryWeight: 3 });
    const derived = await deriveUnits(lab.member, unitId, { deriveType: "clone", quantity: 1 });
    childId = derived.units[0]!.id;
    await recordActivity(lab.member, unitId, { type: "TREATMENT", title: "Foliar spray" });
    await uploadAttachment(lab.member, unitId, {
      label: "Protocol",
      category: "PROTOCOL",
      fileName: "protocol.txt",
      bytes: Buffer.from("Spray at dawn, twice a week.\n"),
    });
  });

  describe("getUnitProfile", () => {
    it("assembles a plain view model with weights as numbers", async () => {
      const profile = await getUnitProfile(lab.admin, unitId);
      if (!profile) throw new Error("profile missing");
      expect(profile).toMatchObject({
        name: "DETAIL-1",
        type: "PLANT",
        status: "active",
        terminal: null,
        stage: "FLOWERING",
        material: "PLANT",
        cultivar: { name: "Northern Lights" },
        experiment: { ecode: "AB1", leadName: "Member" },
        childCount: 1,
        hold: null,
      });
      expect(profile.current).toMatchObject({
        locationName: "Room 2",
        humidWeight: 12.5,
        dryWeight: 3,
        recordedBy: "Member",
      });
      expect(profile.children.map((c) => c.name)).toEqual(["DETAIL-1-CL-1"]);
      expect(profile.locationHistory.totalMoves).toBe(1);
      expect(profile.stageDurations.current?.stage).toBe("FLOWERING");
      expect(() => JSON.stringify(profile)).not.toThrow();
    });

    it("tells admins and experiment members they can edit, and an outsider they cannot", async () => {
      expect((await getUnitProfile(lab.admin, unitId))?.access).toEqual({
        canEdit: true,
        isAdmin: true,
        canRecordQuality: true,
        canReleaseHold: true,
        canDestroy: true,
      });
      // A member places holds and records results on their units; releasing is a quality decision.
      expect((await getUnitProfile(lab.member, unitId))?.access).toEqual({
        canEdit: true,
        isAdmin: false,
        canRecordQuality: true,
        canReleaseHold: false,
        // A member of the experiment may record a destruction of its units.
        canDestroy: true,
      });
      // A member who is not on the experiment does not see its units at all.
      expect(await getUnitProfile(lab.outsider, unitId)).toBeNull();
    });

    it("returns null for an unknown unit", async () => {
      expect(await getUnitProfile(lab.admin, 999_999)).toBeNull();
      expect(await getUnitLedger(lab.admin, 999_999)).toEqual([]);
      expect(await getUnitQuality(lab.admin, 999_999)).toEqual({
        tests: [],
        incidents: [],
        holds: [],
        samples: [],
        tissueSamples: [],
      });
    });

    it("links a derived unit back to its parent and its ancestry", async () => {
      const child = await getUnitProfile(lab.admin, childId);
      expect(child).toMatchObject({ material: "CUTTING", parent: { name: "DETAIL-1" } });
      expect(child?.lineage.mother?.name).toBe("DETAIL-1");
      expect(child?.lineage.generation).toBe(1);
    });
  });

  describe("history", () => {
    it("lists the immutable events in the order they were recorded", async () => {
      const states = await getUnitStates(lab.admin, unitId);
      expect(states.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
      expect(states.map((s) => s.kind)).toEqual(["CREATED", "STAGE_CHANGED", "MOVED", "MEASURED"]);
      expect(states.every((s) => s.recordedBy === "Member")).toBe(true);
    });

    it("orders the ledger newest first with who, what and when on every row", async () => {
      const events = await getUnitLedger(lab.admin, unitId);
      const times = events.map((e) => new Date(e.at).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(events.every((e) => e.actor !== null && e.at)).toBe(true);
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining([
          "REGISTERED",
          "STAGE_CHANGED",
          "MOVED",
          "MEASURED",
          "PRODUCED",
          "ACTIVITY",
          "ATTACHMENT",
        ])
      );
    });

    it("flags the back-dated stage change with the moment it was filed", async () => {
      const events = await getUnitLedger(lab.admin, unitId);
      const stage = events.find((e) => e.type === "STAGE_CHANGED");
      expect(stage?.facts).toMatchObject({ from: "VEGETATIVE", to: "FLOWERING" });
      expect(stage?.note).toBe("late entry");
      expect(stage?.recordedAt).not.toBeNull();
      expect(new Date(stage!.recordedAt!).getTime()).toBeGreaterThan(new Date(stage!.at).getTime());
      // The move, filed the moment it happened, carries no separate filing time.
      expect(events.find((e) => e.type === "MOVED")?.recordedAt).toBeNull();
    });
  });

  describe("quality and documents", () => {
    it("returns lab results, incidents and the hold history", async () => {
      await recordLabTest(lab.member, unitId, {
        panel: TestPanel.POTENCY,
        analyte: "THC",
        value: 30,
        uom: "%",
        labName: "Lab A",
      });
      await placeHold(lab.member, unitId, { reason: "Awaiting inspection", kind: HoldKind.HOLD });
      await openIncident(lab.member, {
        title: "Mould spotted",
        description: "On the lower leaves",
        severity: IncidentSeverity.MAJOR,
        unitId,
      });
      await releaseHold(lab.admin, unitId, { note: "Retest passed after drying" });
      await placeHold(lab.member, unitId, {
        reason: "Second look needed",
        kind: HoldKind.HOLD,
      });

      const quality = await getUnitQuality(lab.admin, unitId);
      expect(quality.tests).toHaveLength(1);
      expect(quality.tests[0]).toMatchObject({
        analyte: "THC",
        value: 30,
        wetWeight: null,
        dryWeight: null,
        recordedBy: "Member",
      });
      expect(quality.incidents[0]).toMatchObject({ title: "Mould spotted", severity: "MAJOR" });
      // Newest first: the open hold, then the released one.
      expect(quality.holds.map((h) => [h.kind, h.origin, h.releasedAt === null])).toEqual([
        ["HOLD", "MANUAL", true],
        ["HOLD", "MANUAL", false],
      ]);
      expect(quality.holds[1]).toMatchObject({
        releasedBy: "Admin",
        releaseNote: "Retest passed after drying",
      });

      const profile = await getUnitProfile(lab.admin, unitId);
      expect(profile).toMatchObject({
        status: "on-hold",
        hold: { kind: "HOLD", reason: "Second look needed", placedBy: "Member" },
      });
    });

    it("lists documents with their checksum and leaves voided ones out", async () => {
      const documents = await getUnitDocuments(lab.admin, unitId);
      expect(documents.activities.map((a) => [a.type, a.title, a.recordedBy])).toEqual([
        ["TREATMENT", "Foliar spray", "Member"],
      ]);
      expect(documents.attachments).toHaveLength(1);
      const attachment = documents.attachments[0]!;
      expect(attachment).toMatchObject({
        label: "Protocol",
        category: "PROTOCOL",
        uploadedBy: "Member",
        sizeBytes: 29,
      });
      expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/);

      await voidAttachment(lab.admin, unitId, attachment.id, { reason: "Superseded by v2" });
      expect((await getUnitDocuments(lab.admin, unitId)).attachments).toEqual([]);
      // The void is still visible in the ledger through the audit trail.
      const events = await getUnitLedger(lab.admin, unitId);
      expect(events.find((e) => e.type === "AUDIT" && e.facts.action === "void")?.note).toContain(
        "Superseded by v2"
      );
    });
  });

  describe("choices for the forms", () => {
    it("finds parent candidates by name, escaping wildcards and never offering the unit itself", async () => {
      const mother = await registerOne(lab, { name: "Mother_100" });
      const names = async (q: string) =>
        (await searchParentCandidates(lab.member, unitId, q)).map((u) => u.name);
      expect(await names("mother")).toEqual(["Mother_100"]);
      expect(await names("detail")).toEqual(["DETAIL-1-CL-1"]);
      expect(await names("m_th")).toEqual([]);
      expect(await names("%")).toEqual([]);
      expect(await names("x")).toEqual([]);

      const orphan = await registerOne(lab, { name: "ORPHAN" });
      await linkParent(lab.member, orphan.id, { parentUnitId: mother.id });
      const link = (await getUnitLedger(lab.admin, orphan.id)).find(
        (e) => e.type === "LINEAGE_LINKED"
      );
      expect(link).toMatchObject({ actor: "Member", facts: { parent: "Mother_100" } });
    });
  });
});
