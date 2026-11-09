import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  GrowthStage,
  HoldKind,
  PermissionLevel,
  SourceType,
  UnitStateKind,
  UnitType,
} from "@/generated/prisma/enums";
import { memberStatus } from "@/lib/invites";
import { prisma } from "@/server/db";
import {
  analyzeCannabase,
  importCannabase,
  type ImportResult,
} from "../../scripts/import-cannabase";
import { runChecks } from "../../scripts/validate-migration";
import {
  SYNTHETIC_COUNTS,
  buildCannabaseFixture,
  renderCannabaseDump,
  syntheticCannabaseDump,
} from "../fixtures/cannabase-dump";
import { resetDatabase, verifyChain } from "./helpers";

const ZONE = "America/Toronto";
const IMPORTED_AT = new Date("2026-10-24T12:00:00.000Z");

type Actor = { id: number; name: string; permissions: import("@/lib/roles").Role };

async function createActor(): Promise<Actor> {
  const admin = await prisma.user.create({
    data: { name: "Importer", email: "importer@lab.example", permissions: PermissionLevel.ADMIN },
  });
  return { id: admin.id, name: admin.name, permissions: "ADMIN" };
}

function runImport(actor: Actor, sql = syntheticCannabaseDump()): Promise<ImportResult> {
  return importCannabase({ sql, actor, timeZone: ZONE, now: IMPORTED_AT, nodeEnv: "test" });
}

const unitNamed = (name: string) =>
  prisma.biologicalUnit.findUniqueOrThrow({
    where: { name },
    include: {
      states: { orderBy: { sequence: "asc" }, include: { location: true, organization: true } },
      currentState: true,
      sourceParentUnit: true,
      derivedUnits: true,
      providerOrganization: true,
      holds: true,
    },
  });

async function tableCounts() {
  const [
    users,
    cultivars,
    locations,
    organizations,
    experiments,
    members,
    units,
    states,
    holds,
    audit,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.cultivar.count(),
    prisma.location.count(),
    prisma.organization.count(),
    prisma.experiment.count(),
    prisma.experimentMember.count(),
    prisma.biologicalUnit.count(),
    prisma.unitState.count(),
    prisma.unitHold.count(),
    prisma.auditLog.count(),
  ]);
  return {
    users,
    cultivars,
    locations,
    organizations,
    experiments,
    members,
    units,
    states,
    holds,
    audit,
  };
}

describe("legacy Cannabase import", () => {
  describe("synthetic dump", () => {
    let actor: Actor;
    let result: ImportResult;

    beforeAll(async () => {
      await resetDatabase();
      actor = await createActor();
      result = await runImport(actor);
    });

    it("creates every entity and reports nothing dropped", () => {
      expect(result.created).toMatchObject({
        users: SYNTHETIC_COUNTS.users,
        cultivars: SYNTHETIC_COUNTS.cultivars,
        locations: SYNTHETIC_COUNTS.locations,
        organizations: SYNTHETIC_COUNTS.organizations,
        experiments: SYNTHETIC_COUNTS.experiments,
        experimentMembers: SYNTHETIC_COUNTS.experimentMembers,
        units: SYNTHETIC_COUNTS.units,
        states: SYNTHETIC_COUNTS.states,
        holds: SYNTHETIC_COUNTS.activeHolds,
      });
      expect(result.issues.filter((issue) => issue.severity === "dropped")).toEqual([]);
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it("writes the expected rows", async () => {
      const counts = await tableCounts();
      expect(counts).toMatchObject({
        users: SYNTHETIC_COUNTS.users + 1,
        cultivars: SYNTHETIC_COUNTS.cultivars,
        locations: SYNTHETIC_COUNTS.locations,
        organizations: SYNTHETIC_COUNTS.organizations,
        experiments: SYNTHETIC_COUNTS.experiments,
        members: SYNTHETIC_COUNTS.experimentMembers,
        units: SYNTHETIC_COUNTS.units,
        states: SYNTHETIC_COUNTS.states,
        holds: SYNTHETIC_COUNTS.activeHolds,
      });
      expect(
        (await prisma.cultivar.findMany({ select: { name: true } })).map((c) => c.name)
      ).toContain("Chemdawg '91");
      expect((await prisma.experiment.findUniqueOrThrow({ where: { ecode: "OA1" } })).name).toBe(
        "Mother stock & cuttings"
      );
      expect(
        (
          await prisma.organization.findFirstOrThrow({
            where: { name: { startsWith: "North Lab" } },
          })
        ).name
      ).toBe("North Lab Analytics (O'Neil & Sons)");
    });

    it("leaves a mother with her cuttings and her own state untouched", async () => {
      const mother = await unitNamed("OA1-001");
      expect(mother.states.map((s) => s.kind)).toEqual([UnitStateKind.CREATED]);
      expect(mother.currentStateId).toBe(mother.states[0]?.id);
      expect(mother.currentState?.growthStage).toBe(GrowthStage.VEGETATIVE);
      expect(mother.derivedUnits.map((u) => u.name).sort()).toEqual([
        "OA1-002",
        "OA1-003",
        "OA1-004",
      ]);

      for (const name of ["OA1-002", "OA1-003", "OA1-004"]) {
        const cutting = await unitNamed(name);
        expect(cutting.sourceParentUnitId).toBe(mother.id);
        expect(cutting.sourceType).toBe(SourceType.CUTTING);
        expect(cutting.states[0]?.parentStateId).toBe(mother.states[0]?.id);
      }
    });

    it("maps a grandchild's parent state to the parent's state at that time", async () => {
      const cutting = await unitNamed("OA1-003");
      const grandchild = await unitNamed("OA2-001");
      expect(grandchild.sourceParentUnitId).toBe(cutting.id);
      // Legacy state 302 was the flowering snapshot, i.e. the STAGE_CHANGED event.
      const flowering = cutting.states.find((s) => s.kind === UnitStateKind.STAGE_CHANGED);
      expect(grandchild.states[0]?.parentStateId).toBe(flowering?.id);
    });

    it("derives events from consecutive snapshots", async () => {
      const kinds = async (name: string) => (await unitNamed(name)).states.map((s) => s.kind);
      expect(await kinds("OA1-002")).toEqual([
        UnitStateKind.CREATED,
        UnitStateKind.MOVED,
        UnitStateKind.STAGE_CHANGED,
        UnitStateKind.DESTROYED,
      ]);
      expect(await kinds("OA1-003")).toEqual([UnitStateKind.CREATED, UnitStateKind.STAGE_CHANGED]);

      const moved = (await unitNamed("OA1-002")).states[1];
      expect(moved?.location?.name).toBe("Room 2 - Flower");
      expect(moved?.growthStage).toBe(GrowthStage.VEGETATIVE);
    });

    it("keeps sequences contiguous and the pointer on the newest state for every unit", async () => {
      const units = await prisma.biologicalUnit.findMany({
        include: { states: { orderBy: { sequence: "asc" } } },
      });
      expect(units).toHaveLength(SYNTHETIC_COUNTS.units);
      for (const unit of units) {
        expect(unit.states.map((s) => s.sequence)).toEqual(unit.states.map((_, i) => i + 1));
        expect(unit.currentStateId).toBe(unit.states[unit.states.length - 1]?.id);
      }
    });

    it("imports destroyed units with their terminal state and reason", async () => {
      const mildew = await unitNamed("OA1-002");
      expect(mildew.currentState).toMatchObject({
        kind: UnitStateKind.DESTROYED,
        reason: "Powdery mildew; whole tray removed",
        witnessId: null,
      });
      expect(mildew.currentState?.effectiveAt.toISOString()).toBe("2025-05-10T18:00:00.000Z");

      const unexplained = await unitNamed("OA1-004");
      expect(unexplained.currentState).toMatchObject({
        kind: UnitStateKind.DESTROYED,
        reason: "Imported from the legacy system (no reason recorded)",
      });
      expect(result.issues.find((issue) => issue.kind === "destroyed-without-reason")?.count).toBe(
        1
      );
    });

    it("imports a received seed lot with its counterparty and counts", async () => {
      const lot = await unitNamed("KE1-001");
      expect(lot.type).toBe(UnitType.SEEDLOT);
      expect(lot.sourceType).toBe(SourceType.RECEIVED);
      expect(lot.providerOrganization?.name).toBe("Green Seeds Ltd.");
      expect(lot.states.map((s) => s.kind)).toEqual([
        UnitStateKind.RECEIVED,
        UnitStateKind.MEASURED,
      ]);
      expect(lot.states[0]).toMatchObject({
        seedCount: 500,
        comment: "Lot SC-2291 received sealed",
      });
      expect(lot.states[0]?.organization?.name).toBe("Green Seeds Ltd.");
      expect(lot.states[0]?.effectiveAt.toISOString()).toBe("2025-02-05T13:30:00.000Z");
      expect(lot.currentState?.seedCount).toBe(480);

      const sown = await unitNamed("KE1-002");
      expect(sown.sourceParentUnitId).toBe(lot.id);
      expect(sown.sourceType).toBe(SourceType.SEED);
    });

    it("carries weights, moves and the shipment on a harvested flower", async () => {
      const flower = await unitNamed("OA2-F01");
      expect(flower.states.map((s) => s.kind)).toEqual([
        UnitStateKind.CREATED,
        UnitStateKind.MEASURED,
        UnitStateKind.MOVED,
        UnitStateKind.STAGE_CHANGED,
        UnitStateKind.SHIPPED,
      ]);
      const [created, measured, moved, staged, shipped] = flower.states;
      expect(Number(created?.humidWeight)).toBe(450.5);
      expect(created?.dryWeight).toBeNull();
      expect(Number(measured?.dryWeight)).toBe(98.25);
      expect(moved?.location?.name).toBe("Vault");
      expect(staged?.growthStage).toBe(GrowthStage.CURING);
      expect(shipped?.organization?.name).toBe("North Lab Analytics (O'Neil & Sons)");
      expect(Number(flower.currentState?.humidWeight)).toBe(450.5);
      expect(Number(flower.currentState?.dryWeight)).toBe(98.25);
      expect(flower.sourceType).toBe(SourceType.HARVEST);
      expect(flower.sourceParentUnit?.name).toBe("OA2-001");
    });

    it("turns the legacy hold into one active hold and keeps un-linked origins as text", async () => {
      const held = await unitNamed("KE1-002");
      expect(held.holds).toHaveLength(1);
      expect(held.holds[0]).toMatchObject({
        kind: HoldKind.HOLD,
        reason: "Suspected spider mites",
        releasedAt: null,
      });

      const stray = await unitNamed("OA10-001");
      expect(stray.sourceParentUnitId).toBeNull();
      expect(stray.sourceDescription).toContain("Roy's clone bank (unverified)");
      expect(Number(stray.currentState?.humidWeight)).toBe(120);
    });

    it("stamps events with the legacy date, the import time and the right author", async () => {
      const mother = await unitNamed("OA1-001");
      const state = mother.states[0]!;
      expect(state.effectiveAt.toISOString()).toBe("2025-01-12T14:00:00.000Z");
      expect(state.recordedAt.toISOString()).toBe(IMPORTED_AT.toISOString());
      const kimy = await prisma.user.findUniqueOrThrow({ where: { name: "Kimy-Li" } });
      expect(state.recordedById).toBe(kimy.id);

      const noRecord = (await unitNamed("OA1-004")).states[0]!;
      expect(noRecord.recordedById).toBe(actor.id);
    });

    it("imports members as pending invitations or deactivated, never with a password", async () => {
      const imported = await prisma.user.findMany({ where: { id: { not: actor.id } } });
      expect(imported).toHaveLength(SYNTHETIC_COUNTS.users);
      for (const user of imported) {
        expect(user.passwordHash).toBe("");
        expect(user.active).toBe(false);
      }

      const pending = imported.filter((u) => u.inviteTokenHash !== null);
      expect(pending).toHaveLength(SYNTHETIC_COUNTS.pendingInvites);
      for (const user of pending) {
        expect(user.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(user.inviteExpiresAt!.getTime()).toBeLessThan(Date.now());
        expect(memberStatus(user)).toBe("invite-expired");
      }
      expect(new Set(pending.map((u) => u.inviteTokenHash)).size).toBe(pending.length);

      const rita = imported.find((u) => u.name === "Rita Retired")!;
      expect(rita.inviteTokenHash).toBeNull();
      expect(memberStatus(rita)).toBe("deactivated");
    });

    it("maps legacy permissions and reports the unknown one", async () => {
      const level = async (name: string) =>
        (await prisma.user.findUniqueOrThrow({ where: { name } })).permissions;
      expect(await level("Helene")).toBe(PermissionLevel.ADMIN);
      expect(await level("Justine")).toBe(PermissionLevel.ADMIN);
      expect(await level("Kimy-Li")).toBe(PermissionLevel.REGULAR);
      expect(await level("Odd Perm")).toBe(PermissionLevel.REGULAR);
      const unknown = result.issues.find((issue) => issue.kind === "unknown-permission");
      expect(unknown).toMatchObject({ severity: "defaulted", count: 1 });
      expect(unknown?.examples[0]).toContain("SUPERVISOR");
    });

    it("keeps experiment codes, sub-experiment and source unit links, team roles and counters", async () => {
      const oa1 = await prisma.experiment.findUniqueOrThrow({
        where: { ecode: "OA1" },
        include: { members: { include: { user: true } } },
      });
      const oa2 = await prisma.experiment.findUniqueOrThrow({
        where: { ecode: "OA2" },
        include: { members: { include: { user: true } } },
      });
      const mother = await unitNamed("OA1-001");
      expect(oa2.parentExperimentId).toBe(oa1.id);
      expect(oa2.sourceUnitId).toBe(mother.id);

      const roles = (members: typeof oa1.members) =>
        members.map((m) => `${m.user.name}:${m.role}`).sort();
      expect(roles(oa1.members)).toEqual(["Kevin:MEMBER", "Kimy-Li:LEAD"]);
      expect(roles(oa2.members)).toEqual(["Helene:LEAD", "Julien Roy:MEMBER"]);

      const counters = await prisma.experimentCodeCounter.findMany({ orderBy: { prefix: "asc" } });
      expect(counters.map((c) => [c.prefix, c.lastNumber])).toEqual([
        ["KE", 1],
        ["OA", 10],
      ]);
      const [next] = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT next_experiment_number('OA') AS n`;
      expect(next?.n).toBe(11);
    });

    it("audits each entity type once, then the run, all chained and by the actor", async () => {
      const entries = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });
      expect(entries.map((e) => e.entityType)).toEqual([
        "user",
        "cultivar",
        "location",
        "organization",
        "experiment",
        "unit",
        "import",
      ]);
      expect(entries.every((e) => e.action === "import" && e.userId === actor.id)).toBe(true);

      const final = entries[entries.length - 1]!;
      expect(JSON.stringify(final.details)).toContain(result.checksum);
      expect(await verifyChain()).toEqual([]);
    });

    it("passes the migration validation, including reconciliation with the dump", async () => {
      const validation = await runChecks({ sql: syntheticCannabaseDump(), timeZone: ZONE });
      expect(validation.checks.filter((c) => c.failures.length > 0)).toEqual([]);
      expect(validation.failed).toBe(false);
      expect(validation.skipped).toEqual([]);
      expect(validation.counts).toMatchObject({
        units: SYNTHETIC_COUNTS.units,
        states: SYNTHETIC_COUNTS.states,
      });
    });

    it("is idempotent: a second run creates nothing and changes nothing", async () => {
      const stateIds = async () =>
        (await prisma.unitState.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map(
          (s) => s.id
        );
      const before = { counts: await tableCounts(), states: await stateIds() };
      const usersBefore = await prisma.user.findMany({ orderBy: { id: "asc" } });

      const again = await runImport(actor);

      expect(Object.values(again.created).every((count) => count === 0)).toBe(true);
      expect(again.existing).toMatchObject({
        users: SYNTHETIC_COUNTS.users,
        cultivars: SYNTHETIC_COUNTS.cultivars,
        locations: SYNTHETIC_COUNTS.locations,
        organizations: SYNTHETIC_COUNTS.organizations,
        experiments: SYNTHETIC_COUNTS.experiments,
        units: SYNTHETIC_COUNTS.units,
      });

      const after = { counts: await tableCounts(), states: await stateIds() };
      // The only new row is the audit entry recording that the run happened.
      expect(after.counts).toEqual({ ...before.counts, audit: before.counts.audit + 1 });
      expect(after.states).toEqual(before.states);
      expect(await prisma.user.findMany({ orderBy: { id: "asc" } })).toEqual(usersBefore);

      const [latest] = await prisma.auditLog.findMany({ orderBy: { seq: "desc" }, take: 1 });
      expect(latest).toMatchObject({ entityType: "import", action: "import" });
      expect(await verifyChain()).toEqual([]);
      expect((await runChecks({ sql: syntheticCannabaseDump(), timeZone: ZONE })).failed).toBe(
        false
      );
    });
  });

  describe("safety", () => {
    let actor: Actor;

    beforeEach(async () => {
      await resetDatabase();
      actor = await createActor();
    });

    it("refuses to run in production unless explicitly allowed", async () => {
      await expect(
        importCannabase({ sql: syntheticCannabaseDump(), actor, nodeEnv: "production" })
      ).rejects.toThrow(/--allow-production/);
      expect(await prisma.biologicalUnit.count()).toBe(0);

      await expect(
        importCannabase({
          sql: "",
          actor,
          nodeEnv: "production",
          allowProduction: true,
          timeZone: ZONE,
          now: IMPORTED_AT,
        })
      ).resolves.toMatchObject({ created: { units: 0 } });
    });

    it("requires an existing, active administrator as the actor", async () => {
      const regular = await prisma.user.create({
        data: { name: "Regular", email: "r@lab.example" },
      });
      await expect(
        runImport({ id: regular.id, name: regular.name, permissions: "ADMIN" })
      ).rejects.toThrow(/administrator/);
      await expect(runImport({ id: 9999, name: "Ghost", permissions: "ADMIN" })).rejects.toThrow(
        /does not exist/
      );

      await prisma.user.update({ where: { id: actor.id }, data: { active: false } });
      await expect(runImport(actor)).rejects.toThrow(/administrator/);
      expect(await prisma.biologicalUnit.count()).toBe(0);
    });

    it("never overwrites or deletes what is already there", async () => {
      const existing = await prisma.cultivar.create({
        data: { name: "northern lights", comment: "edited by an operator" },
      });
      const helene = await prisma.user.create({
        data: { name: "HELENE", email: "h@lab.example", passwordHash: "keep-me", active: true },
      });

      const result = await runImport(actor);

      expect(result.created.cultivars).toBe(SYNTHETIC_COUNTS.cultivars - 1);
      expect(result.existing).toMatchObject({ cultivars: 1, users: 1 });
      expect(await prisma.cultivar.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject(
        {
          name: "northern lights",
          comment: "edited by an operator",
        }
      );
      expect(await prisma.user.findUniqueOrThrow({ where: { id: helene.id } })).toMatchObject({
        passwordHash: "keep-me",
        active: true,
        inviteTokenHash: null,
      });
      // Cuttings of the existing-cultivar mother still resolve to the operator's record.
      expect((await unitNamed("OA1-001")).cultivarId).toBe(existing.id);
      expect(await verifyChain()).toEqual([]);
    });
  });

  describe("values that cannot be carried over", () => {
    function anomalousDump() {
      const fixture = buildCannabaseFixture();
      // Unknown unit type: the unit is not imported.
      fixture.BiologicalUnits!.rows.push([
        11,
        "XX-001",
        1,
        null,
        "MYCELIUM",
        null,
        null,
        null,
        null,
        null,
      ]);
      fixture.States!.rows.push([1101, "PLANT", "2025-05-01 09:00:00", 11]);
      // Unknown growth stage, negative weight, a state after destruction.
      fixture.PlantStates!.rows.find((r) => r[0] === 1001)![1] = "BLOOMING";
      fixture.FlowerStates!.rows.find((r) => r[0] === 602)![2] = -5;
      fixture.States!.rows.push([403, "PLANT", "2025-03-01 09:00:00", 4]);
      // A member sharing another member's e-mail.
      fixture.Users!.rows.find((r) => r[0] === 6)![4] = "helene@lab.example";
      // Two cuttings, each recorded as the other's parent.
      fixture.BiologicalUnits!.rows.push(
        [12, "CY-001", 1, null, "PLANT", null, null, null, null, null],
        [13, "CY-002", 1, null, "PLANT", null, null, null, null, null]
      );
      fixture.States!.rows.push(
        [1201, "PLANT", "2025-06-01 09:00:00", 12],
        [1301, "PLANT", "2025-06-02 09:00:00", 13]
      );
      fixture.Stores!.rows.push([1201, 1], [1301, 1]);
      fixture.Manipulations!.rows.push([1201, 1301, "a"], [1301, 1201, "b"]);
      return renderCannabaseDump(fixture);
    }

    it("counts and lists every dropped or defaulted value", () => {
      const { issues } = analyzeCannabase(anomalousDump(), { timeZone: ZONE, now: IMPORTED_AT });
      const byKind = new Map(issues.map((issue) => [issue.kind, issue]));

      expect(byKind.get("unknown-unit-type")).toMatchObject({ severity: "dropped", count: 1 });
      expect(byKind.get("unknown-unit-type")?.examples[0]).toContain("MYCELIUM");
      expect(byKind.get("unknown-growth-stage")).toMatchObject({ severity: "dropped", count: 1 });
      expect(byKind.get("negative-quantity")).toMatchObject({ severity: "dropped", count: 1 });
      expect(byKind.get("state-after-terminal")).toMatchObject({ severity: "dropped", count: 1 });
      expect(byKind.get("duplicate-email")).toMatchObject({ severity: "dropped", count: 1 });
      expect(byKind.get("lineage-cycle")).toMatchObject({ severity: "dropped", count: 1 });
      expect(byKind.get("unknown-permission")).toMatchObject({ severity: "defaulted", count: 1 });
    });

    it("imports everything else, and the validation then fails on the dropped values", async () => {
      await resetDatabase();
      const actor = await createActor();
      const sql = anomalousDump();

      const result = await runImport(actor, sql);

      expect(result.created.units).toBe(SYNTHETIC_COUNTS.units + 2); // the cycle pair, not the mycelium
      expect(await prisma.biologicalUnit.findUnique({ where: { name: "XX-001" } })).toBeNull();
      // The state after destruction was not written: the unit still ends in DESTROYED.
      expect((await unitNamed("OA1-004")).currentState?.kind).toBe(UnitStateKind.DESTROYED);
      // The cycle was broken, so the lineage is acyclic.
      const first = await unitNamed("CY-001");
      const second = await unitNamed("CY-002");
      expect([first.sourceParentUnitId, second.sourceParentUnitId].filter(Boolean)).toHaveLength(1);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { name: "Rita Retired" } })).email
      ).toBeNull();
      expect(await verifyChain()).toEqual([]);

      const validation = await runChecks({ sql, timeZone: ZONE });
      expect(validation.failed).toBe(true);
      const failing = validation.checks.filter((c) => c.failures.length > 0).map((c) => c.name);
      expect(failing).toEqual(["No legacy values were dropped as non-importable"]);
      // The database itself is sound; only the legacy values need a decision.
      expect(validation.checks.find((c) => c.name === "Audit chain is intact")?.failures).toEqual(
        []
      );
    });
  });
});
