import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type {
  HoldKind,
  HoldOrigin,
  IncidentSeverity,
  IncidentStatus,
  TestPanel,
  UnitType,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { zonedDateKey } from "@/lib/lab-time";
import { isQuality } from "@/lib/roles";
import { likeEscape } from "@/lib/search-text";
import { unitStanding, type UnitStanding } from "@/lib/unit-standing";
import { unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";

export {
  DESTROYED_LIST_SORTS,
  listDestroyedUnits,
  listWasteEntries,
  WASTE_LIMIT,
  type DestroyedListParams,
  type DestroyedListRow,
  type WasteRow,
} from "./destroyed";
export {
  getRecallTrace,
  searchRecallUnits,
  type RecallNode,
  type RecallSearchHit,
  type RecallTrace,
} from "./recall";

/** Lab results for one unit, newest first. Voided results stay in the database but out of view. */
export async function listUnitTests(unitId: number) {
  return prisma.labTest.findMany({
    where: { unitId, voidedAt: null },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { testedAt: "desc" },
  });
}

/** Incidents that are not closed or voided, optionally for one unit. */
export async function listOpenIncidents(opts?: { unitId?: number; limit?: number }) {
  const where: Prisma.QualityIncidentWhereInput = {
    voidedAt: null,
    status: { not: "CLOSED" },
    ...(opts?.unitId ? { unitId: opts.unitId } : {}),
  };
  return prisma.qualityIncident.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true } },
      cultivar: { select: { id: true, name: true } },
      experiment: { select: { id: true, ecode: true } },
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 100,
  });
}

/** Every incident that is not voided (open or closed), newest first. */
export async function listIncidents(user: SessionUser, opts: { limit: number }) {
  return prisma.qualityIncident.findMany({
    where: { voidedAt: null, OR: [{ unitId: null }, { unit: { is: unitReadScope(user) } }] },
    include: {
      user: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true } },
      cultivar: { select: { id: true, name: true } },
      experiment: { select: { id: true, ecode: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(opts.limit, 1), 200),
  });
}

// --- Quality console ------------------------------------------------------------------------------

export const QA_VIEWS = ["overview", "holds", "tests", "incidents"] as const;
export type QaView = (typeof QA_VIEWS)[number];

/** Sort keys each list understands; the first is its default. */
export const QA_SORTS = {
  holds: ["age", "unit"],
  tests: ["date", "unit", "panel"],
  incidents: ["severity", "date", "status", "title"],
} as const;

export const QA_SEVERITIES = ["CRITICAL", "MAJOR", "MINOR"] as const;

/** Rows each list shows on the overview before it links to its full, paged view. */
export const QA_PREVIEW_ROWS = 10;

export type QaOverviewParams = {
  view: QaView;
  q?: string;
  sort?: string;
  order: "asc" | "desc";
  page: number;
  limit: number;
  /** Only used by the list it belongs to. */
  severity?: IncidentSeverity;
};

export type QaHoldRow = {
  holdId: number;
  unit: { id: number; name: string; type: UnitType };
  kind: HoldKind;
  origin: HoldOrigin;
  reason: string;
  placedAt: Date;
  placedBy: string;
  placedById: number;
  ageDays: number;
  locationId: number | null;
  locationName: string | null;
};

export type QaTestRow = {
  id: number;
  unit: { id: number; name: string; type: UnitType };
  panel: TestPanel;
  analyte: string | null;
  value: number | null;
  uom: string | null;
  wetWeight: number | null;
  dryWeight: number | null;
  labName: string | null;
  testedAt: Date;
  recordedBy: { id: number; name: string };
};

export type QaIncidentRow = {
  id: number;
  /** Short code made by the database (INC-001). */
  code: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  resolution: string | null;
  createdAt: Date;
  unit: { id: number; name: string } | null;
  cultivar: { id: number; name: string } | null;
  experiment: { id: number; ecode: string } | null;
  openedBy: string;
  openedById: number;
};

export type QaOverview = {
  counts: {
    holds: number;
    /** Lab results on record (not voided). */
    tests: number;
    openIncidents: number;
    criticalIncidents: number;
    majorIncidents: number;
    minorIncidents: number;
  };
  holds: { rows: QaHoldRow[]; total: number };
  tests: { rows: QaTestRow[]; total: number };
  incidents: { rows: QaIncidentRow[]; total: number };
};

const DAY_MS = 86_400_000;

function sortKey<T extends readonly string[]>(
  allowed: T,
  requested: string | undefined
): T[number] {
  const pick = (allowed as readonly string[]).find((key) => key === requested);
  return (pick ?? allowed[0]) as T[number];
}

/** The page of one list: the whole preview on the overview, the requested page in its own view. */
function windowFor(params: QaOverviewParams, active: boolean) {
  if (params.view === "overview") return { skip: 0, take: QA_PREVIEW_ROWS };
  if (!active) return null;
  return { skip: (params.page - 1) * params.limit, take: params.limit };
}

function contains(text: string) {
  return { contains: likeEscape(text), mode: "insensitive" as const };
}

function holdsWhere(user: SessionUser, params: QaOverviewParams): Prisma.UnitHoldWhereInput {
  const needle = params.q?.trim();
  return {
    releasedAt: null,
    unit: { is: unitReadScope(user) },
    ...(needle
      ? { OR: [{ reason: contains(needle) }, { unit: { is: { name: contains(needle) } } }] }
      : {}),
  };
}

function testsWhere(user: SessionUser, params: QaOverviewParams): Prisma.LabTestWhereInput {
  const needle = params.q?.trim();
  return {
    voidedAt: null,
    unit: { is: unitReadScope(user) },
    ...(needle
      ? {
          OR: [
            { analyte: contains(needle) },
            { labName: contains(needle) },
            { unit: { is: { name: contains(needle) } } },
          ],
        }
      : {}),
  };
}

function incidentsWhere(
  user: SessionUser,
  params: QaOverviewParams
): Prisma.QualityIncidentWhereInput {
  const needle = params.q?.trim();
  return {
    voidedAt: null,
    status: { not: "CLOSED" },
    // An incident with no unit has nothing to scope; one with a unit follows the unit's scope.
    AND: [
      { OR: [{ unitId: null }, { unit: { is: unitReadScope(user) } }] },
      ...(needle
        ? [
            {
              OR: [
                { code: contains(needle) },
                { title: contains(needle) },
                { description: contains(needle) },
                { unit: { is: { name: contains(needle) } } },
              ],
            },
          ]
        : []),
    ],
    ...(params.view === "incidents" && params.severity ? { severity: params.severity } : {}),
  };
}

function holdsOrder(params: QaOverviewParams): Prisma.UnitHoldOrderByWithRelationInput[] {
  const order = params.order;
  switch (params.view === "holds" ? sortKey(QA_SORTS.holds, params.sort) : "age") {
    case "unit":
      return [{ unit: { name: order } }, { id: order }];
    default:
      // "Age, descending" means the longest-held first, which is the earliest placement.
      return [{ placedAt: order === "desc" ? "asc" : "desc" }, { id: "asc" }];
  }
}

function testsOrder(params: QaOverviewParams): Prisma.LabTestOrderByWithRelationInput[] {
  const order = params.order;
  switch (params.view === "tests" ? sortKey(QA_SORTS.tests, params.sort) : "date") {
    case "unit":
      return [{ unit: { name: order } }, { testedAt: "desc" }, { id: "desc" }];
    case "panel":
      return [{ panel: order }, { analyte: "asc" }, { id: "desc" }];
    default:
      return [{ testedAt: order }, { id: order }];
  }
}

function incidentsOrder(
  params: QaOverviewParams
): Prisma.QualityIncidentOrderByWithRelationInput[] {
  const order = params.order;
  switch (params.view === "incidents" ? sortKey(QA_SORTS.incidents, params.sort) : "severity") {
    case "date":
      return [{ createdAt: order }, { id: order }];
    case "status":
      return [{ status: order }, { createdAt: "desc" }, { id: "desc" }];
    case "title":
      return [{ title: order }, { id: "asc" }];
    default:
      // "Severity, descending" means the most severe first, which is the first enum value.
      return [
        { severity: order === "desc" ? "asc" : "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ];
  }
}

/**
 * Everything the quality console shows: headline counts, units on hold, recorded lab results and
 * open incidents. Filtering, search, sorting and paging are done by the database;
 * the overview shows a short preview of each list, a list's own view pages through all of it.
 */
export async function getQaOverview(
  user: SessionUser,
  params: QaOverviewParams
): Promise<QaOverview> {
  const now = Date.now();
  const holdsAll = holdsWhere(user, { ...params, q: undefined });
  const testsAll = testsWhere(user, { ...params, q: undefined });
  const incidentsAll = incidentsWhere(user, { ...params, q: undefined, severity: undefined });

  const holdsWindow = windowFor(params, params.view === "holds");
  const testsWindow = windowFor(params, params.view === "tests");
  const incidentsWindow = windowFor(params, params.view === "incidents");

  const [
    holdCount,
    testCount,
    openCount,
    criticalCount,
    majorCount,
    minorCount,
    holdsTotal,
    testsTotal,
    incidentsTotal,
    holds,
    tests,
    incidents,
  ] = await Promise.all([
    prisma.unitHold.count({ where: holdsAll }),
    prisma.labTest.count({ where: testsAll }),
    prisma.qualityIncident.count({ where: incidentsAll }),
    prisma.qualityIncident.count({ where: { ...incidentsAll, severity: "CRITICAL" } }),
    prisma.qualityIncident.count({ where: { ...incidentsAll, severity: "MAJOR" } }),
    prisma.qualityIncident.count({ where: { ...incidentsAll, severity: "MINOR" } }),
    prisma.unitHold.count({ where: holdsWhere(user, params) }),
    prisma.labTest.count({ where: testsWhere(user, params) }),
    prisma.qualityIncident.count({ where: incidentsWhere(user, params) }),
    holdsWindow
      ? prisma.unitHold.findMany({
          where: holdsWhere(user, params),
          orderBy: holdsOrder(params),
          ...holdsWindow,
          select: {
            id: true,
            kind: true,
            origin: true,
            reason: true,
            placedAt: true,
            placedBy: { select: { id: true, name: true } },
            unit: {
              select: {
                id: true,
                name: true,
                type: true,
                currentState: {
                  select: { locationId: true, location: { select: { name: true } } },
                },
              },
            },
          },
        })
      : [],
    testsWindow
      ? prisma.labTest.findMany({
          where: testsWhere(user, params),
          orderBy: testsOrder(params),
          ...testsWindow,
          select: {
            id: true,
            panel: true,
            analyte: true,
            value: true,
            uom: true,
            wetWeight: true,
            dryWeight: true,
            labName: true,
            testedAt: true,
            user: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true, type: true } },
          },
        })
      : [],
    incidentsWindow
      ? prisma.qualityIncident.findMany({
          where: incidentsWhere(user, params),
          orderBy: incidentsOrder(params),
          ...incidentsWindow,
          select: {
            id: true,
            code: true,
            title: true,
            description: true,
            severity: true,
            status: true,
            resolution: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true } },
            cultivar: { select: { id: true, name: true } },
            experiment: { select: { id: true, ecode: true } },
          },
        })
      : [],
  ]);

  return {
    counts: {
      holds: holdCount,
      tests: testCount,
      openIncidents: openCount,
      criticalIncidents: criticalCount,
      majorIncidents: majorCount,
      minorIncidents: minorCount,
    },
    holds: {
      total: holdsTotal,
      rows: holds.map((hold): QaHoldRow => ({
        holdId: hold.id,
        unit: { id: hold.unit.id, name: hold.unit.name, type: hold.unit.type },
        kind: hold.kind,
        origin: hold.origin,
        reason: hold.reason,
        placedAt: hold.placedAt,
        placedBy: hold.placedBy.name,
        placedById: hold.placedBy.id,
        ageDays: Math.max(0, Math.floor((now - hold.placedAt.getTime()) / DAY_MS)),
        locationId: hold.unit.currentState?.locationId ?? null,
        locationName: hold.unit.currentState?.location?.name ?? null,
      })),
    },
    tests: {
      total: testsTotal,
      rows: tests.map((test): QaTestRow => ({
        id: test.id,
        unit: test.unit,
        panel: test.panel,
        analyte: test.analyte,
        value: test.value,
        uom: test.uom,
        wetWeight: test.wetWeight,
        dryWeight: test.dryWeight,
        labName: test.labName,
        testedAt: test.testedAt,
        recordedBy: test.user,
      })),
    },
    incidents: {
      total: incidentsTotal,
      rows: incidents.map((incident): QaIncidentRow => ({
        id: incident.id,
        code: incident.code,
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        resolution: incident.resolution,
        createdAt: incident.createdAt,
        unit: incident.unit,
        cultivar: incident.cultivar,
        experiment: incident.experiment,
        openedBy: incident.user.name,
        openedById: incident.user.id,
      })),
    },
  };
}

// --- Unit lookup for the forms --------------------------------------------------------------------

export type QaUnitOption = {
  id: number;
  name: string;
  type: UnitType;
  standing: UnitStanding;
};

/**
 * Units to pick from in the hold and incident forms. `holdable` keeps only units a new hold can
 * be placed on (still in inventory and not already held); `any` keeps everything.
 */
export async function searchUnitOptions(
  user: SessionUser,
  q: string,
  scope: "any" | "holdable",
  limit = 8
): Promise<QaUnitOption[]> {
  const needle = q.trim();
  if (needle.length < 1) return [];
  const units = await prisma.biologicalUnit.findMany({
    where: {
      AND: [
        unitReadScope(user),
        { name: { contains: likeEscape(needle), mode: "insensitive" } },
        scope === "holdable"
          ? {
              currentState: { is: { kind: { notIn: [...NO_STOCK_KINDS] } } },
              holds: { none: { releasedAt: null } },
            }
          : {},
      ],
    },
    orderBy: { name: "asc" },
    take: Math.min(Math.max(limit, 1), 25),
    select: {
      id: true,
      name: true,
      type: true,
      currentState: { select: { kind: true } },
      holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
    },
  });
  return units.map((unit) => ({
    id: unit.id,
    name: unit.name,
    type: unit.type,
    standing: unitStanding(unit.currentState?.kind, unit.holds[0]?.kind),
  }));
}

// --- One incident, with its corrective and preventive actions ------------------------------------

/** An incident and its CAPA, for its own page; null when it does not exist or is out of scope. */
export async function getIncidentDetail(user: SessionUser, id: number) {
  const incident = await prisma.qualityIncident.findFirst({
    where: {
      id,
      voidedAt: null,
      OR: [{ unitId: null }, { unit: { is: unitReadScope(user) } }],
    },
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      severity: true,
      status: true,
      resolution: true,
      createdAt: true,
      closedAt: true,
      user: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true } },
      cultivar: { select: { id: true, name: true } },
      experiment: { select: { id: true, ecode: true } },
      sop: { select: { id: true, code: true, title: true } },
      capaActions: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          code: true,
          kind: true,
          description: true,
          status: true,
          dueDate: true,
          createdAt: true,
          completedAt: true,
          completionNote: true,
          verifiedAt: true,
          verificationNote: true,
          owner: { select: { id: true, name: true } },
          createdBy: { select: { name: true } },
          completedBy: { select: { name: true } },
          verifiedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!incident) return null;
  const zone = env().LAB_TIMEZONE;
  const today = zonedDateKey(new Date(), zone);
  const [members, sops] = isQuality(user)
    ? await Promise.all([
        prisma.user.findMany({
          where: { active: true, permissions: { not: "INSPECTOR" } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.sop.findMany({
          orderBy: { code: "asc" },
          select: { id: true, code: true, title: true },
        }),
      ])
    : [[], []];
  return {
    ...incident,
    capaActions: incident.capaActions.map((capa) => {
      const due = capa.dueDate ? zonedDateKey(capa.dueDate, zone) : null;
      return {
        ...capa,
        due,
        overdue: capa.status === "OPEN" && due !== null && due < today,
        canComplete: capa.status === "OPEN" && (isQuality(user) || capa.owner?.id === user.id),
        canVerify: capa.status === "DONE" && isQuality(user),
      };
    }),
    canManage: isQuality(user),
    members,
    /** The procedures it may be linked to (quality assurance only). */
    sops,
  };
}

export type IncidentDetail = NonNullable<Awaited<ReturnType<typeof getIncidentDetail>>>;
