import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  LicenceClass,
  MaterialClass,
  ShipmentDirection,
  ShipmentStatus,
  TestPanel,
  UnitType,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import type { MaterialTotals } from "@/lib/materials";
import {
  relationsOf,
  totalsFromGroups,
  type OrganizationRelation,
} from "@/lib/organization-profile";
import { likeEscape } from "@/lib/search-text";
import { unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";

export { ORGANIZATION_RELATIONS, type OrganizationRelation } from "@/lib/organization-profile";

export const ORGANIZATION_LIST_SORTS = ["name", "country", "units", "shipments"] as const;
export type OrganizationListSort = (typeof ORGANIZATION_LIST_SORTS)[number];

export type OrganizationListParams = {
  q?: string;
  relation?: OrganizationRelation;
  country?: string;
  sort: OrganizationListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type OrganizationListRow = {
  id: number;
  /** Short code made by the database. */
  code: string;
  name: string;
  country: string | null;
  address: string | null;
  licenceNumber: string | null;
  suppliedUnits: number;
  inboundShipments: number;
  outboundShipments: number;
  labResults: number;
  relations: OrganizationRelation[];
};

/**
 * Lab results carry the lab's name as text, not a link, so a result belongs to an organization when
 * the names match ignoring case and surrounding spaces.
 */
const LAB_MATCH = Prisma.sql`lower(btrim(t."labName")) = lower(btrim(o."name")) AND t."voidedAt" IS NULL`;

async function organizationIdsWithLabResults(): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT DISTINCT o."id" FROM "Organization" o JOIN "LabTest" t ON ${LAB_MATCH}`;
  return rows.map((row) => row.id);
}

async function labResultCounts(ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: number; total: number }>>`
    SELECT o."id", count(*)::int AS "total"
    FROM "Organization" o JOIN "LabTest" t ON ${LAB_MATCH}
    WHERE o."id" IN (${Prisma.join(ids)})
    GROUP BY o."id"`;
  return new Map(rows.map((row) => [row.id, row.total]));
}

function relationWhere(
  relation: OrganizationRelation | undefined,
  labIds: number[]
): Prisma.OrganizationWhereInput {
  switch (relation) {
    case "supplier":
      return {
        OR: [
          { suppliedUnits: { some: {} } },
          { shipments: { some: { direction: "INBOUND", voidedAt: null } } },
        ],
      };
    case "recipient":
      return { shipments: { some: { direction: "OUTBOUND", voidedAt: null } } };
    case "lab":
      return { id: { in: labIds } };
    default:
      return {};
  }
}

function orderByFor(
  sort: OrganizationListSort,
  order: "asc" | "desc"
): Prisma.OrganizationOrderByWithRelationInput[] {
  const primary: Prisma.OrganizationOrderByWithRelationInput =
    sort === "country"
      ? { country: { sort: order, nulls: "last" } }
      : sort === "units"
        ? { suppliedUnits: { _count: order } }
        : sort === "shipments"
          ? { shipments: { _count: order } }
          : { name: order };
  return [primary, { id: order }];
}

/** One page of organizations; the relation (supplier, recipient, lab) is told from their records. */
export async function listOrganizations(
  _user: SessionUser,
  params: OrganizationListParams
): Promise<{ rows: OrganizationListRow[]; total: number }> {
  const needle = params.q?.trim() ? likeEscape(params.q.trim()) : undefined;
  const labIds = params.relation === "lab" ? await organizationIdsWithLabResults() : [];
  const where: Prisma.OrganizationWhereInput = {
    AND: [
      relationWhere(params.relation, labIds),
      params.country ? { country: { equals: params.country, mode: "insensitive" } } : {},
      needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" } },
              { code: { contains: needle, mode: "insensitive" } },
              { country: { contains: needle, mode: "insensitive" } },
              { address: { contains: needle, mode: "insensitive" } },
              { licenceNumber: { contains: needle, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [total, organizations] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: orderByFor(params.sort, params.order),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        code: true,
        name: true,
        country: true,
        address: true,
        licenceNumber: true,
        _count: { select: { suppliedUnits: true } },
      },
    }),
  ]);

  const ids = organizations.map((o) => o.id);
  const [shipmentCounts, labCounts] = await Promise.all([
    ids.length
      ? prisma.shipment.groupBy({
          by: ["organizationId", "direction"],
          where: { organizationId: { in: ids }, voidedAt: null },
          _count: { _all: true },
        })
      : [],
    labResultCounts(ids),
  ]);
  const shipmentsOf = (id: number, direction: ShipmentDirection) =>
    shipmentCounts.find((c) => c.organizationId === id && c.direction === direction)?._count._all ??
    0;

  return {
    total,
    rows: organizations.map((o) => {
      const evidence = {
        suppliedUnits: o._count.suppliedUnits,
        inboundShipments: shipmentsOf(o.id, "INBOUND"),
        outboundShipments: shipmentsOf(o.id, "OUTBOUND"),
        labResults: labCounts.get(o.id) ?? 0,
      };
      return {
        id: o.id,
        code: o.code,
        name: o.name,
        country: o.country,
        address: o.address,
        licenceNumber: o.licenceNumber,
        ...evidence,
        relations: relationsOf(evidence),
      };
    }),
  };
}

/** Countries in use, for the filter. */
export async function listOrganizationCountries(): Promise<string[]> {
  const rows = await prisma.organization.findMany({
    where: { country: { not: null } },
    distinct: ["country"],
    orderBy: { country: "asc" },
    select: { country: true },
  });
  return rows.flatMap((row) => (row.country?.trim() ? [row.country] : []));
}

/** Name, country and licence of every organization: the choice list of the shipment form. */
export async function listOrganizationOptions() {
  return prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, country: true, licenceNumber: true },
  });
}

// --- Detail -----------------------------------------------------------------------------------

export const ORGANIZATION_SECTION_SIZE = 10;

export type OrganizationSectionPages = {
  inbound: number;
  outbound: number;
  units: number;
  tests: number;
};

export type OrganizationShipmentRow = {
  id: number;
  reference: string;
  status: ShipmentStatus;
  direction: ShipmentDirection;
  /** Delivered, else shipped, else created. */
  date: Date;
  lines: number;
  recordedBy: string;
  recordedById: number;
};

export type OrganizationUnitRow = {
  id: number;
  name: string;
  type: UnitType;
  cultivar: { id: number; name: string } | null;
  experiment: { id: number; ecode: string } | null;
  /** How the unit relates to the organization: it came from it, or (part of it) went to it. */
  relation: "supplied" | "shipped";
};

export type OrganizationTestRow = {
  id: number;
  unit: { id: number; name: string };
  panel: TestPanel;
  analyte: string | null;
  value: number | null;
  uom: string | null;
  testedAt: Date;
  /** The lab itself performed it, or it was run on material this organization supplied. */
  relation: "performed" | "supplied";
};

export type OrganizationAuditRow = {
  id: number;
  createdAt: Date;
  userId: number | null;
  userName: string;
  summary: string;
};

export type OrganizationDocumentRow = {
  id: number;
  label: string;
  fileName: string;
  sizeBytes: number | null;
  createdAt: Date;
  userName: string;
};

export type OrganizationDetail = {
  organization: {
    id: number;
    code: string;
    name: string;
    address: string | null;
    country: string | null;
    licenceNumber: string | null;
    licenceClass: LicenceClass | null;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  relations: OrganizationRelation[];
  counts: {
    suppliedUnits: number;
    unitsReceived: number;
    unitsShipped: number;
    shipments: number;
  };
  inboundTotals: MaterialTotals;
  outboundTotals: MaterialTotals;
  inbound: { rows: OrganizationShipmentRow[]; total: number };
  outbound: { rows: OrganizationShipmentRow[]; total: number };
  /** The units this organization supplied or received, by kind. */
  unitTypes: Array<{ type: UnitType; count: number }>;
  units: { rows: OrganizationUnitRow[]; total: number };
  tests: { rows: OrganizationTestRow[]; total: number };
  activity: OrganizationAuditRow[];
  documents: OrganizationDocumentRow[];
};

/** Material that actually moved: drafts and cancelled shipments are paperwork, not custody. */
const MOVED: ShipmentStatus[] = ["IN_TRANSIT", "DELIVERED"];

async function totalsFor(organizationId: number, direction: ShipmentDirection) {
  const groups = await prisma.shipmentItem.groupBy({
    by: ["materialType", "moisture"],
    where: {
      shipment: { organizationId, direction, voidedAt: null, status: { in: MOVED } },
    },
    _sum: { unitCount: true, weightGrams: true },
  });
  return totalsFromGroups(
    groups.map((g) => ({
      materialType: g.materialType satisfies MaterialClass,
      moisture: g.moisture,
      unitCount: g._sum.unitCount,
      weightGrams: g._sum.weightGrams == null ? null : Number(g._sum.weightGrams),
    }))
  );
}

async function shipmentPage(organizationId: number, direction: ShipmentDirection, page: number) {
  const where: Prisma.ShipmentWhereInput = { organizationId, direction, voidedAt: null };
  const [total, rows] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * ORGANIZATION_SECTION_SIZE,
      take: ORGANIZATION_SECTION_SIZE,
      select: {
        id: true,
        reference: true,
        status: true,
        direction: true,
        shippedDate: true,
        deliveredDate: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  return {
    total,
    rows: rows.map((s): OrganizationShipmentRow => ({
      id: s.id,
      reference: s.reference,
      status: s.status,
      direction: s.direction,
      date: s.deliveredDate ?? s.shippedDate ?? s.createdAt,
      lines: s._count.items,
      recordedBy: s.user.name,
      recordedById: s.user.id,
    })),
  };
}

export async function getOrganizationDetail(
  user: SessionUser,
  id: number,
  pages: OrganizationSectionPages
): Promise<OrganizationDetail | null> {
  const organization = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      country: true,
      licenceNumber: true,
      licenceClass: true,
      comment: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!organization) return null;

  const suppliedWhere: Prisma.BiologicalUnitWhereInput = {
    AND: [unitReadScope(user), { providerOrganizationId: id }],
  };
  // The units this organization supplied, received from it, or shipped (in part or in full) to it.
  const unitWhere: Prisma.BiologicalUnitWhereInput = {
    AND: [
      unitReadScope(user),
      {
        OR: [{ providerOrganizationId: id }, { states: { some: { organizationId: id } } }],
      },
    ],
  };
  const testWhere: Prisma.LabTestWhereInput = {
    voidedAt: null,
    OR: [
      { unit: { is: suppliedWhere } },
      { labName: { equals: organization.name.trim(), mode: "insensitive" } },
    ],
  };

  const [
    inbound,
    outbound,
    inboundTotals,
    outboundTotals,
    unitTotal,
    units,
    testTotal,
    tests,
    unitsReceived,
    unitsShipped,
    activity,
    labResults,
    documents,
    unitTypes,
  ] = await Promise.all([
    shipmentPage(id, "INBOUND", pages.inbound),
    shipmentPage(id, "OUTBOUND", pages.outbound),
    totalsFor(id, "INBOUND"),
    totalsFor(id, "OUTBOUND"),
    prisma.biologicalUnit.count({ where: unitWhere }),
    prisma.biologicalUnit.findMany({
      where: unitWhere,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (pages.units - 1) * ORGANIZATION_SECTION_SIZE,
      take: ORGANIZATION_SECTION_SIZE,
      select: {
        id: true,
        name: true,
        type: true,
        providerOrganizationId: true,
        cultivar: { select: { id: true, name: true } },
        experiment: { select: { id: true, ecode: true } },
      },
    }),
    prisma.labTest.count({ where: testWhere }),
    prisma.labTest.findMany({
      where: testWhere,
      orderBy: [{ testedAt: "desc" }, { id: "desc" }],
      skip: (pages.tests - 1) * ORGANIZATION_SECTION_SIZE,
      take: ORGANIZATION_SECTION_SIZE,
      select: {
        id: true,
        panel: true,
        analyte: true,
        value: true,
        uom: true,
        testedAt: true,
        labName: true,
        unit: { select: { id: true, name: true } },
      },
    }),
    prisma.unitState.count({ where: { organizationId: id, kind: "RECEIVED" } }),
    prisma.unitState.count({
      where: { organizationId: id, kind: { in: ["SHIPPED_PART", "SHIPPED"] } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: "organization", entityId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true, createdAt: true, userId: true, userName: true, summary: true },
    }),
    labResultCounts([id]),
    prisma.organizationAttachment.findMany({
      where: { organizationId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        label: true,
        fileName: true,
        sizeBytes: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.biologicalUnit.groupBy({ by: ["type"], where: unitWhere, _count: { _all: true } }),
  ]);

  const performedBy = organization.name.trim().toLowerCase();
  const relations = relationsOf({
    suppliedUnits: unitTotal,
    inboundShipments: inbound.total,
    outboundShipments: outbound.total,
    labResults: labResults.get(id) ?? 0,
  });

  return {
    organization,
    relations,
    counts: {
      suppliedUnits: unitTotal,
      unitsReceived,
      unitsShipped,
      shipments: inbound.total + outbound.total,
    },
    inboundTotals,
    outboundTotals,
    inbound,
    outbound,
    units: {
      total: unitTotal,
      rows: units.map(({ providerOrganizationId, ...unit }) => ({
        ...unit,
        relation: providerOrganizationId === id ? ("supplied" as const) : ("shipped" as const),
      })),
    },
    unitTypes: unitTypes
      .map((row) => ({ type: row.type, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    tests: {
      total: testTotal,
      rows: tests.map(({ labName, ...test }) => ({
        ...test,
        relation: labName?.trim().toLowerCase() === performedBy ? "performed" : "supplied",
      })),
    },
    activity,
    documents: documents.map((d) => ({
      id: d.id,
      label: d.label,
      fileName: d.fileName,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      userName: d.user.name,
    })),
  };
}
