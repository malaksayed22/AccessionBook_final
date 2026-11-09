import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { UnitType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { likeEscape } from "@/lib/search-text";
import { experimentReadScope, isAdmin, unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import type { Role } from "@/lib/roles";

/*
 * Search. Two entry points share the same safety rules: text is escaped before it reaches LIKE
 * (so "50%" means 50%), units are narrowed by `unitReadScope`, and organizations and members
 * (people's names and e-mail addresses) are only searched for administrators.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
/** Hits listed per group on the results page; each group also reports its full count. */
export const SEARCH_GROUP_LIMIT = 10;

/** The trimmed, length-limited needle, or undefined when it is too short to search. */
export function normalizeSearchText(raw: string | undefined | null): string | undefined {
  const text = raw?.trim().slice(0, SEARCH_MAX_LENGTH).trim();
  return text && text.length >= SEARCH_MIN_LENGTH ? text : undefined;
}

const insensitive = (needle: string) => ({
  contains: likeEscape(needle),
  mode: "insensitive" as const,
});

function unitWhere(user: SessionUser, needle: string): Prisma.BiologicalUnitWhereInput {
  const match = insensitive(needle);
  return {
    AND: [
      unitReadScope(user),
      {
        OR: [
          { name: match },
          { comment: match },
          { cultivar: { is: { name: match } } },
          { experiment: { is: { ecode: match } } },
          { experiment: { is: { name: match } } },
        ],
      },
    ],
  };
}

/** Only experiments the user may open: a member never learns the name of someone else's study. */
const experimentWhere = (user: SessionUser, needle: string): Prisma.ExperimentWhereInput => {
  const match = insensitive(needle);
  return {
    AND: [
      experimentReadScope(user),
      { OR: [{ name: match }, { ecode: match }, { comment: match }] },
    ],
  };
};

const cultivarWhere = (needle: string): Prisma.CultivarWhereInput => {
  const match = insensitive(needle);
  return { OR: [{ name: match }, { code: match }, { commonName: match }, { comment: match }] };
};

const organizationWhere = (needle: string): Prisma.OrganizationWhereInput => {
  const match = insensitive(needle);
  return { OR: [{ name: match }, { licenceNumber: match }, { country: match }] };
};

const memberWhere = (needle: string): Prisma.UserWhereInput => {
  const match = insensitive(needle);
  return { OR: [{ name: match }, { email: match }, { initials: match }] };
};

export type SearchGroup<Hit> = { total: number; hits: Hit[] };

export type UnitHit = {
  id: number;
  name: string;
  type: UnitType;
  cultivarId: number | null;
  cultivarName: string | null;
  experimentId: number | null;
  experimentCode: string | null;
  locationId: number | null;
  locationName: string | null;
  status: "active" | "on-hold" | "destroyed";
};

export type SearchResults = {
  /** The text that was searched (trimmed). */
  query: string;
  units: SearchGroup<UnitHit>;
  experiments: SearchGroup<{ id: number; ecode: string; name: string }>;
  cultivars: SearchGroup<{
    id: number;
    name: string;
    code: string | null;
    commonName: string | null;
  }>;
  /** Administrators only; null for everyone else. */
  organizations: SearchGroup<{
    id: number;
    name: string;
    country: string | null;
    licenceNumber: string | null;
  }> | null;
  members: SearchGroup<{
    id: number;
    name: string;
    email: string | null;
    permissions: Role;
    active: boolean;
  }> | null;
};

function statusOf(kind: string | undefined, hold: string | undefined): UnitHit["status"] {
  if (kind === "DESTROYED") return "destroyed";
  return hold ? "on-hold" : "active";
}

/** Everything matching `needle`, grouped, with the full count of each group. */
export async function searchAll(user: SessionUser, needle: string): Promise<SearchResults> {
  const admin = isAdmin(user);
  const take = SEARCH_GROUP_LIMIT;
  const units = unitWhere(user, needle);
  const experiments = experimentWhere(user, needle);
  const cultivars = cultivarWhere(needle);
  const organizations = organizationWhere(needle);
  const members = memberWhere(needle);

  const [
    unitTotal,
    unitHits,
    experimentTotal,
    experimentHits,
    cultivarTotal,
    cultivarHits,
    organizationGroup,
    memberGroup,
  ] = await Promise.all([
    prisma.biologicalUnit.count({ where: units }),
    prisma.biologicalUnit.findMany({
      where: units,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        name: true,
        type: true,
        cultivarId: true,
        experimentId: true,
        cultivar: { select: { name: true } },
        experiment: { select: { ecode: true } },
        currentState: {
          select: { kind: true, locationId: true, location: { select: { name: true } } },
        },
        holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
      },
    }),
    prisma.experiment.count({ where: experiments }),
    prisma.experiment.findMany({
      where: experiments,
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      take,
      select: { id: true, ecode: true, name: true },
    }),
    prisma.cultivar.count({ where: cultivars }),
    prisma.cultivar.findMany({
      where: cultivars,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: { id: true, name: true, code: true, commonName: true },
    }),
    admin
      ? Promise.all([
          prisma.organization.count({ where: organizations }),
          prisma.organization.findMany({
            where: organizations,
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take,
            select: { id: true, name: true, country: true, licenceNumber: true },
          }),
        ])
      : null,
    admin
      ? Promise.all([
          prisma.user.count({ where: members }),
          prisma.user.findMany({
            where: members,
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take,
            select: { id: true, name: true, email: true, permissions: true, active: true },
          }),
        ])
      : null,
  ]);

  return {
    query: needle,
    units: {
      total: unitTotal,
      hits: unitHits.map((unit) => ({
        id: unit.id,
        name: unit.name,
        type: unit.type,
        cultivarId: unit.cultivarId,
        cultivarName: unit.cultivar?.name ?? null,
        experimentId: unit.experimentId,
        experimentCode: unit.experiment?.ecode ?? null,
        locationId: unit.currentState?.locationId ?? null,
        locationName: unit.currentState?.location?.name ?? null,
        status: statusOf(unit.currentState?.kind, unit.holds[0]?.kind),
      })),
    },
    experiments: { total: experimentTotal, hits: experimentHits },
    cultivars: { total: cultivarTotal, hits: cultivarHits },
    organizations: organizationGroup
      ? { total: organizationGroup[0], hits: organizationGroup[1] }
      : null,
    members: memberGroup ? { total: memberGroup[0], hits: memberGroup[1] } : null,
  };
}

/**
 * Quick lookup for the command palette: a few of each kind, no counts. The shape is the one the
 * palette reads, so keep it stable.
 */
export async function lookup(user: SessionUser, rawQuery: string) {
  const needle = normalizeSearchText(rawQuery);
  if (!needle) return { units: [], experiments: [], cultivars: [] };

  const unitSelect = {
    id: true,
    name: true,
    type: true,
    experiment: { select: { ecode: true } },
    cultivar: { select: { name: true } },
    currentState: { select: { location: { select: { name: true } } } },
  } satisfies Prisma.BiologicalUnitSelect;

  const [units, experiments, cultivars] = await Promise.all([
    prisma.biologicalUnit.findMany({
      where: unitWhere(user, needle),
      take: 8,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: unitSelect,
    }),
    prisma.experiment.findMany({
      where: experimentWhere(user, needle),
      take: 6,
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      select: { id: true, ecode: true, name: true },
    }),
    prisma.cultivar.findMany({
      where: cultivarWhere(needle),
      take: 6,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true, commonName: true },
    }),
  ]);

  // Typing a unit's number jumps straight to it, if the member may read it.
  const numericId = /^\d{1,9}$/.test(needle) ? Number(needle) : 0;
  if (numericId > 0) {
    const byId = await prisma.biologicalUnit.findFirst({
      where: { AND: [unitReadScope(user), { id: numericId }] },
      select: unitSelect,
    });
    if (byId && !units.some((unit) => unit.id === byId.id)) units.unshift(byId);
  }
  return { units, experiments, cultivars };
}
