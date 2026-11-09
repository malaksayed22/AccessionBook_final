import "server-only";
import type { SessionUser } from "@/lib/auth";
import { getLocationOccupancy } from "@/lib/lab";
import { canEditExperiment, isAdmin, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import type { ActionBootstrap, ActionUnit } from "./types";
import { isReadOnly, worksOnAllUnits } from "@/lib/roles";
import { isEmptied } from "@/lib/stock-kinds";

/**
 * What the launcher needs about one unit: where it stands and whether this person may change it.
 * Computed on the server so the launcher never trusts props that a page could have got stale.
 * Returns null when the unit does not exist or is outside the person's read scope.
 */
export async function getActionUnit(user: SessionUser, unitId: number): Promise<ActionUnit | null> {
  const unit = await prisma.biologicalUnit.findFirst({
    where: { id: unitId, ...unitReadScope(user) },
    select: {
      id: true,
      name: true,
      type: true,
      experimentId: true,
      currentState: {
        select: {
          kind: true,
          locationId: true,
          growthStage: true,
          humidWeight: true,
          dryWeight: true,
          seedCount: true,
        },
      },
      holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
    },
  });
  if (!unit) return null;

  const kind = unit.currentState?.kind;
  const hold = unit.holds[0]?.kind ?? null;
  const status: ActionUnit["status"] =
    kind === "DESTROYED" ? "destroyed" : hold === "HOLD" ? "on-hold" : "active";

  return {
    id: unit.id,
    name: unit.name,
    type: unit.type,
    experimentId: unit.experimentId,
    status,
    nothingLeft: isEmptied(kind),
    holdKind: hold,
    locationId: unit.currentState?.locationId ?? null,
    growthStage: unit.currentState?.growthStage ?? null,
    humidWeight: unit.currentState?.humidWeight?.toNumber() ?? null,
    dryWeight: unit.currentState?.dryWeight?.toNumber() ?? null,
    seedCount: unit.currentState?.seedCount ?? null,
    canEdit:
      !isReadOnly(user) &&
      (worksOnAllUnits(user) || (await canEditExperiment(prisma, user, unit.experimentId))),
  };
}

/**
 * Everything the "Take action" forms need to populate their pickers, in one round trip. Pass
 * `unitId` when the launcher is opened on a unit page.
 */
export async function getActionBootstrap(
  user: SessionUser,
  options: { unitId?: number } = {}
): Promise<ActionBootstrap> {
  const admin = isAdmin(user);
  const [experiments, cultivars, locationsRaw, organizations, members, occupancy, unit] =
    await Promise.all([
      prisma.experiment.findMany({
        where: admin ? {} : { members: { some: { userId: user.id } } },
        orderBy: { startDate: "desc" },
        select: { id: true, ecode: true, name: true },
      }),
      prisma.cultivar.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      getLocationOccupancy(),
      options.unitId ? getActionUnit(user, options.unitId) : null,
    ]);

  return {
    user: { id: user.id, name: user.name, permissions: user.permissions },
    experiments,
    cultivars,
    locations: locationsRaw.map((location) => ({
      id: location.id,
      name: location.name,
      capacity: location.capacity,
      occupancy: occupancy.get(location.id) ?? 0,
    })),
    organizations,
    users: admin ? members : [],
    unit,
  };
}
