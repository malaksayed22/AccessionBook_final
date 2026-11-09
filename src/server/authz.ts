import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import {
  canManageLocations,
  canReadCompliance,
  isQuality,
  seesWholeLab,
  worksOnAllUnits,
} from "@/lib/roles";
import { errors } from "./errors";

/**
 * Every permission rule of the application, in one place, used identically by pages, route
 * handlers and services. Changing who may do something is a one-line edit here.
 *
 * Model: ADMIN can do everything. REGULAR members work on the experiments they belong to. QA,
 * INVENTORY and INSPECTOR see the whole laboratory and do only their part of the work (see
 * `lib/roles.ts`); an inspector changes nothing (enforced for every request in `server/http.ts`).
 * Destruction and shipping stay admin-only.
 */
type Db = Prisma.TransactionClient;

export function isAdmin(user: Pick<SessionUser, "permissions">): boolean {
  return user.permissions === "ADMIN";
}

export function assertAdmin(user: Pick<SessionUser, "permissions">, message?: string): void {
  if (!isAdmin(user)) throw errors.forbidden(message ?? "Only admins can do that");
}

async function isExperimentMember(db: Db, userId: number, experimentId: number): Promise<boolean> {
  const membership = await db.experimentMember.findUnique({
    where: { experimentId_userId: { experimentId, userId } },
    select: { userId: true },
  });
  return membership !== null;
}

/** Admins, or members of the experiment. */
export async function canEditExperiment(
  db: Db,
  user: SessionUser,
  experimentId: number | null | undefined
): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!experimentId) return false;
  return isExperimentMember(db, user.id, experimentId);
}

export async function assertCanEditExperiment(
  db: Db,
  user: SessionUser,
  experimentId: number | null | undefined,
  message = "Only admins or members of this experiment can do that"
): Promise<void> {
  if (!(await canEditExperiment(db, user, experimentId))) throw errors.forbidden(message);
}

/** Who may change a unit: an inventory manager, or whoever may edit the experiment it belongs to. */
export async function assertCanEditUnit(
  db: Db,
  user: SessionUser,
  unit: { experimentId: number | null }
): Promise<void> {
  if (worksOnAllUnits(user)) return;
  await assertCanEditExperiment(
    db,
    user,
    unit.experimentId,
    "Only admins or members of this unit's experiment can change it"
  );
}

export async function assertCanCreateUnit(
  db: Db,
  user: SessionUser,
  experimentId: number
): Promise<void> {
  await assertCanEditExperiment(
    db,
    user,
    experimentId,
    "Only admins or responsible experiment members can add units"
  );
}

/** Holds, lab results and incidents on a unit: quality assurance, or whoever may change the unit. */
export async function assertCanRecordQuality(
  db: Db,
  user: SessionUser,
  unit: { experimentId: number | null }
): Promise<void> {
  if (isQuality(user)) return;
  await assertCanEditUnit(db, user, unit);
}

/** Releasing a hold re-opens movement of regulated material: a quality decision (admin or QA). */
export function assertCanReleaseHold(user: SessionUser): void {
  if (!isQuality(user))
    throw errors.forbidden("Only quality assurance or an admin can release a hold");
}

/** Voiding an incident, or changing one not linked to a unit. */
export function assertCanManageIncidents(user: SessionUser): void {
  if (!isQuality(user)) {
    throw errors.forbidden("Only quality assurance or an admin can do that to an incident");
  }
}

/** The regulatory reports and the audit trail: admins, quality assurance and inspectors. */
export function assertCanReadCompliance(user: SessionUser): void {
  if (!canReadCompliance(user)) throw errors.forbidden("You cannot see compliance records");
}

export function assertCanManageLocations(user: SessionUser): void {
  if (!canManageLocations(user)) {
    throw errors.forbidden("Only an inventory manager or an admin can manage locations");
  }
}

/** Receiving and shipping are custody records: admin-only. */
export function assertCanManageShipments(user: SessionUser): void {
  assertAdmin(user, "Only admins can record shipments and receipts");
}

/** Notes on a destroyed unit are the one allowed edit after destruction, and only for admins. */
export function assertCanAnnotateDestroyedUnit(user: SessionUser): void {
  assertAdmin(user, "Destroyed units are read-only. Only admins can add or update notes.");
}

/**
 * Who may READ units: every role but a member sees the whole laboratory, a member only the units of the
 * experiments they belong to (the same rule as `experimentReadScope`). Every unit list, detail page,
 * search, trace and report query applies this one filter.
 */
export function unitReadScope(user: SessionUser): Prisma.BiologicalUnitWhereInput {
  return seesWholeLab(user)
    ? {}
    : { experiment: { is: { members: { some: { userId: user.id } } } } };
}

/**
 * Who may READ shipments, as SQL on a shipment aliased `s`: administrators see every movement, a
 * member only the ones that carried a unit of an experiment they belong to.
 */
export function shipmentReadSql(user: SessionUser): Prisma.Sql {
  if (seesWholeLab(user)) return Prisma.sql`TRUE`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ShipmentItem" ri
    JOIN "BiologicalUnit" ru ON ru."id" = ri."unitId"
    JOIN "ExperimentMember" rm ON rm."experimentId" = ru."experimentId"
    WHERE ri."shipmentId" = s."id" AND rm."userId" = ${user.id}
  )`;
}

/**
 * Who may READ experiments: administrators see every experiment, a member sees only the ones they
 * belong to. Experiment lists, pages, pickers and documents all apply this one filter.
 */
export function experimentReadScope(user: SessionUser): Prisma.ExperimentWhereInput {
  return seesWholeLab(user) ? {} : { members: { some: { userId: user.id } } };
}
