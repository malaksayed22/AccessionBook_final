import type { SessionUser } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { GrowthStage, SourceType, UnitType } from "@/generated/prisma/enums";
import { registerUnits } from "@/features/unit/service";
import { prisma } from "@/server/db";

/** Every table, in one TRUNCATE. */
const TABLES = [
  "AuditLog",
  "Notification",
  "LabSettings",
  "Session",
  "MfaRecoveryCode",
  "RateLimitBucket",
  "UnitActivity",
  "UnitAttachment",
  "ShipmentItem",
  "Shipment",
  "LabTest",
  "QualityIncident",
  "UnitHold",
  "UnitState",
  "BiologicalUnit",
  "ExperimentMember",
  "ExperimentCodeCounter",
  "Experiment",
  "Cultivar",
  "Location",
  "Organization",
  "SavedView",
  "Task",
  "CapaAction",
  "TissueSample",
  "SopSignoff",
  "SopVersion",
  "Sop",
  "User",
];

/**
 * Test-only reset. The audit trail rejects TRUNCATE by design, so the guard triggers are
 * switched off for this one statement; production code never does this.
 */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER USER`);
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
    );
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER USER`);
  }
}

export async function createUser(name: string, overrides: Partial<{ email: string }> = {}) {
  return prisma.user.create({
    data: {
      name,
      email: overrides.email ?? `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
    },
  });
}

export async function appendAudit(userId: number, summary: string) {
  return prisma.auditLog.create({
    data: {
      userId,
      userName: "tester",
      userRole: "ADMIN",
      entityType: "test",
      entityId: 1,
      entityLabel: "t",
      action: "noop",
      summary,
    },
  });
}

export async function verifyChain() {
  return prisma.$queryRaw<Array<{ broken_seq: number; reason: string }>>`
    SELECT * FROM audit_verify_chain()`;
}

export function asActor(user: { id: number; name: string; permissions: Role }) {
  return { id: user.id, name: user.name, permissions: user.permissions } satisfies SessionUser;
}

/** A small lab: an admin, a member of the experiment, an outsider, a witness, and reference data. */
export async function createLab() {
  const [admin, member, outsider, witness] = await Promise.all([
    prisma.user.create({
      data: { name: "Admin", email: "admin@example.com", permissions: "ADMIN" },
    }),
    prisma.user.create({ data: { name: "Member", email: "member@example.com" } }),
    prisma.user.create({ data: { name: "Outsider", email: "outsider@example.com" } }),
    prisma.user.create({ data: { name: "Witness", email: "witness@example.com" } }),
  ]);
  const experiment = await prisma.experiment.create({
    data: { ecode: "AB1", name: "Test experiment", startDate: new Date("2026-01-01T00:00:00Z") },
  });
  await prisma.experimentMember.create({
    data: { experimentId: experiment.id, userId: member.id, role: "LEAD" },
  });
  const cultivar = await prisma.cultivar.create({ data: { name: "Northern Lights" } });
  const [room1, room2, room3] = await Promise.all(
    ["Room 1", "Room 2", "Room 3"].map((name) => prisma.location.create({ data: { name } }))
  );
  const provider = await prisma.organization.create({ data: { name: "Seed Supplier Inc." } });
  return {
    admin: asActor(admin),
    member: asActor(member),
    outsider: asActor(outsider),
    witness: asActor(witness),
    experiment,
    cultivar,
    rooms: [room1!, room2!, room3!] as const,
    provider,
  };
}

type Lab = Awaited<ReturnType<typeof createLab>>;

/** Registers one unit through the real service. */
export async function registerOne(
  lab: Lab,
  overrides: Partial<Parameters<typeof registerUnits>[1]> = {}
) {
  const result = await registerUnits(lab.member, {
    type: UnitType.PLANT,
    name: "P1",
    quantity: 1,
    experimentId: lab.experiment.id,
    cultivarId: lab.cultivar.id,
    locationId: lab.rooms[0].id,
    sourceType: SourceType.INTERNAL,
    sourceDescription: "Internal lab stock for testing",
    growthStage: GrowthStage.VEGETATIVE,
    ...overrides,
  } as Parameters<typeof registerUnits>[1]);
  const first = result.units[0]!;
  return first;
}

export async function statesOf(unitId: number) {
  return prisma.unitState.findMany({ where: { unitId }, orderBy: { sequence: "asc" } });
}
