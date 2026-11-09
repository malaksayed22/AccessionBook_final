import "server-only";
import type {
  HoldKind,
  HoldOrigin,
  ShipmentDirection,
  ShipmentStatus,
  UnitType,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { likeEscape } from "@/lib/search-text";
import { hasNothingLeft, unitStanding, type UnitStanding } from "@/lib/unit-standing";
import { unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { NO_STOCK_KINDS } from "@/lib/stock-kinds";

export type RecallRelation = "self" | "ancestor" | "descendant" | "same-cultivar";

export type RecallNode = {
  id: number;
  name: string;
  type: UnitType;
  relation: RecallRelation;
  /** Negative upstream (the mother is the most negative), 0 for the origin, positive downstream. */
  generation: number | null;
  /** The unit this one was derived from, when that unit is in the trace. */
  parentId: number | null;
  standing: UnitStanding;
  hold: { kind: HoldKind; origin: HoldOrigin; reason: string; placedAt: Date } | null;
  cultivar: string | null;
  cultivarId: number | null;
  experiment: { id: number; ecode: string } | null;
  /** Where the unit is now (only while it is in inventory). */
  locationName: string | null;
  locationId: number | null;
  /** True once a shipment took everything that was left: still on record, nothing in stock. */
  nothingLeft: boolean;
  /** Organizations that received this unit, in part or in full. */
  shippedTo: Array<{ id: number; name: string }>;
  /** The outbound shipments this unit left on. */
  shipmentIds: number[];
};

export type RecallShipment = {
  id: number;
  reference: string;
  direction: ShipmentDirection;
  status: ShipmentStatus;
  organization: { id: number; name: string; licenceNumber: string | null };
  /** Units of the trace that are on this shipment. */
  unitNames: string[];
  units: Array<{ id: number; name: string }>;
};

export type RecallTrace = {
  origin: RecallNode;
  /** Mother first, the origin's parent last. */
  upstream: RecallNode[];
  /** Depth first: each unit is followed by everything derived from it. */
  downstream: RecallNode[];
  sameCultivar: RecallNode[];
  sameCultivarTotal: number;
  /** True when the trace was cut at the size limit: more units were derived than are listed. */
  truncated: boolean;
  shipments: RecallShipment[];
  organizations: Array<{
    id: number;
    name: string;
    licenceNumber: string | null;
    unitCount: number;
    shipmentIds: number[];
  }>;
  counts: {
    upstream: number;
    downstream: number;
    sameCultivar: number;
    inInventory: number;
    onHold: number;
    shipped: number;
    destroyed: number;
    shipments: number;
    organizations: number;
  };
};

export const MAX_DESCENDANTS = 200;
export const MAX_PEERS = 80;
const MAX_DEPTH = 50;

const nodeSelect = {
  id: true,
  name: true,
  type: true,
  sourceParentUnitId: true,
  cultivarId: true,
  cultivar: { select: { name: true } },
  experiment: { select: { id: true, ecode: true } },
  currentState: {
    select: {
      kind: true,
      locationId: true,
      location: { select: { name: true } },
      organization: { select: { id: true, name: true } },
    },
  },
  holds: {
    where: { releasedAt: null },
    select: { kind: true, origin: true, reason: true, placedAt: true },
    take: 1,
  },
} as const;

type UnitRow = {
  id: number;
  name: string;
  type: UnitType;
  sourceParentUnitId: number | null;
  cultivarId: number | null;
  cultivar: { name: string } | null;
  experiment: { id: number; ecode: string } | null;
  currentState: {
    kind: string;
    locationId: number | null;
    location: { name: string } | null;
    organization: { id: number; name: string } | null;
  } | null;
  holds: Array<{ kind: HoldKind; origin: HoldOrigin; reason: string; placedAt: Date }>;
};

function toNode(
  row: UnitRow,
  relation: RecallRelation,
  generation: number | null,
  parentId: number | null
): RecallNode {
  const hold = row.holds[0] ?? null;
  const standing = unitStanding(row.currentState?.kind, hold?.kind);
  const nothingLeft = hasNothingLeft(row.currentState?.kind);
  const inStock = standing !== "destroyed" && !nothingLeft;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    relation,
    generation,
    parentId,
    standing,
    hold,
    cultivar: row.cultivar?.name ?? null,
    cultivarId: row.cultivarId,
    experiment: row.experiment,
    locationId: inStock ? (row.currentState?.locationId ?? null) : null,
    locationName: inStock ? (row.currentState?.location?.name ?? null) : null,
    nothingLeft,
    shippedTo: [],
    shipmentIds: [],
  };
}

/** The mother line, walking `sourceParentUnitId`; a cycle or a missing parent ends the walk. */
async function walkAncestors(start: UnitRow): Promise<RecallNode[]> {
  const chain: UnitRow[] = [];
  const seen = new Set<number>([start.id]);
  let nextId = start.sourceParentUnitId;
  while (nextId && !seen.has(nextId) && chain.length < MAX_DEPTH) {
    seen.add(nextId);
    const parent: UnitRow | null = await prisma.biologicalUnit.findUnique({
      where: { id: nextId },
      select: nodeSelect,
    });
    if (!parent) break;
    chain.unshift(parent);
    nextId = parent.sourceParentUnitId;
  }
  return chain.map((row, index) =>
    toNode(row, "ancestor", index - chain.length, chain[index - 1]?.id ?? null)
  );
}

/** Everything derived from the origin, level by level, then ordered so children follow parents. */
async function walkDescendants(
  rootId: number
): Promise<{ nodes: RecallNode[]; truncated: boolean }> {
  const found: RecallNode[] = [];
  const seen = new Set<number>([rootId]);
  let frontier = [rootId];
  let depth = 0;
  let truncated = false;

  while (frontier.length > 0 && depth < MAX_DEPTH && !truncated) {
    depth += 1;
    const children: UnitRow[] = await prisma.biologicalUnit.findMany({
      where: { sourceParentUnitId: { in: frontier } },
      select: nodeSelect,
      orderBy: { id: "asc" },
    });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      if (found.length >= MAX_DESCENDANTS) {
        truncated = true;
        break;
      }
      seen.add(child.id);
      found.push(toNode(child, "descendant", depth, child.sourceParentUnitId));
      frontier.push(child.id);
    }
  }

  // Depth first, so the table reads like a tree.
  const childrenOf = new Map<number, RecallNode[]>();
  for (const node of found) {
    const key = node.parentId ?? rootId;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), node]);
  }
  const ordered: RecallNode[] = [];
  const visit = (parentId: number) => {
    for (const child of childrenOf.get(parentId) ?? []) {
      ordered.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return { nodes: ordered, truncated };
}

/**
 * Reverse and forward trace of one unit for a recall: the mother line above it, everything
 * derived from it, where each of those units is now (location, shipped-to organization, hold),
 * the shipments they left on, and the other inventory of the same cultivar. Null if the unit does
 * not exist or the member may not read it.
 */
export async function getRecallTrace(
  user: SessionUser,
  unitId: number
): Promise<RecallTrace | null> {
  const start: UnitRow | null = await prisma.biologicalUnit.findFirst({
    where: { AND: [unitReadScope(user), { id: unitId }] },
    select: nodeSelect,
  });
  if (!start) return null;

  const [upstream, downstream] = await Promise.all([
    walkAncestors(start),
    walkDescendants(start.id),
  ]);
  const origin = toNode(start, "self", 0, start.sourceParentUnitId);
  const lineage = [origin, ...upstream, ...downstream.nodes];
  const lineageIds = lineage.map((node) => node.id);

  const [items, peers, peerTotal] = await Promise.all([
    prisma.shipmentItem.findMany({
      where: {
        unitId: { in: lineageIds },
        shipment: { voidedAt: null, status: { not: "CANCELLED" } },
      },
      orderBy: { id: "asc" },
      select: {
        unitId: true,
        shipment: {
          select: {
            id: true,
            reference: true,
            direction: true,
            status: true,
            organization: { select: { id: true, name: true, licenceNumber: true } },
          },
        },
      },
    }),
    start.cultivar
      ? prisma.biologicalUnit.findMany({
          where: {
            AND: [
              unitReadScope(user),
              {
                cultivar: { is: { name: start.cultivar.name } },
                id: { notIn: lineageIds },
                currentState: { is: { kind: { notIn: [...NO_STOCK_KINDS] } } },
              },
            ],
          },
          select: nodeSelect,
          orderBy: { name: "asc" },
          take: MAX_PEERS,
        })
      : Promise.resolve([] as UnitRow[]),
    start.cultivar
      ? prisma.biologicalUnit.count({
          where: {
            AND: [
              unitReadScope(user),
              {
                cultivar: { is: { name: start.cultivar.name } },
                id: { notIn: lineageIds },
                currentState: { is: { kind: { notIn: [...NO_STOCK_KINDS] } } },
              },
            ],
          },
        })
      : Promise.resolve(0),
  ]);

  const nameById = new Map(lineage.map((node) => [node.id, node.name]));
  const shipmentsById = new Map<number, RecallShipment>();
  for (const item of items) {
    if (item.unitId === null) continue;
    const entry = shipmentsById.get(item.shipment.id) ?? {
      ...item.shipment,
      unitNames: [],
      units: [],
    };
    const unitName = nameById.get(item.unitId) ?? String(item.unitId);
    entry.unitNames.push(unitName);
    entry.units.push({ id: item.unitId, name: unitName });
    shipmentsById.set(item.shipment.id, entry);
    if (item.shipment.direction === "OUTBOUND") {
      const node = lineage.find((candidate) => candidate.id === item.unitId);
      node?.shipmentIds.push(item.shipment.id);
      const receiver = item.shipment.organization;
      if (node && !node.shippedTo.some((org) => org.id === receiver.id)) {
        node.shippedTo.push({ id: receiver.id, name: receiver.name });
      }
    }
  }
  const shipments = [...shipmentsById.values()];

  const organizationsById = new Map<
    number,
    {
      id: number;
      name: string;
      licenceNumber: string | null;
      units: Set<number>;
      ships: Set<number>;
    }
  >();
  for (const item of items) {
    if (item.unitId === null || item.shipment.direction !== "OUTBOUND") continue;
    const org = item.shipment.organization;
    const entry = organizationsById.get(org.id) ?? { ...org, units: new Set(), ships: new Set() };
    entry.units.add(item.unitId);
    entry.ships.add(item.shipment.id);
    organizationsById.set(org.id, entry);
  }

  const sameCultivar = peers.map((row) => toNode(row, "same-cultivar", null, null));
  return {
    origin,
    upstream,
    downstream: downstream.nodes,
    sameCultivar,
    sameCultivarTotal: peerTotal,
    truncated: downstream.truncated,
    shipments,
    organizations: [...organizationsById.values()].map((org) => ({
      id: org.id,
      name: org.name,
      licenceNumber: org.licenceNumber,
      unitCount: org.units.size,
      shipmentIds: [...org.ships],
    })),
    counts: {
      upstream: upstream.length,
      downstream: downstream.nodes.length,
      sameCultivar: peerTotal,
      inInventory: lineage.filter((n) => n.standing !== "destroyed" && !n.nothingLeft).length,
      onHold: lineage.filter((n) => n.hold !== null && n.standing !== "destroyed" && !n.nothingLeft)
        .length,
      /** Units that left the laboratory in part or in full. */
      shipped: lineage.filter((n) => n.shipmentIds.length > 0).length,
      destroyed: lineage.filter((n) => n.standing === "destroyed").length,
      shipments: shipments.length,
      organizations: organizationsById.size,
    },
  };
}

// --- Finding the unit to trace --------------------------------------------------------------------

export type RecallSearchHit = {
  id: number;
  name: string;
  type: UnitType;
  cultivar: string | null;
  cultivarId: number | null;
  standing: UnitStanding;
  nothingLeft: boolean;
};

/** Units whose name contains the text, or whose id it is. Short list, best match first. */
export async function searchRecallUnits(
  user: SessionUser,
  q: string,
  limit = 20
): Promise<RecallSearchHit[]> {
  const needle = q.trim();
  if (!needle) return [];
  const id = /^\d{1,9}$/.test(needle) ? Number(needle) : null;
  const units = await prisma.biologicalUnit.findMany({
    where: {
      AND: [
        unitReadScope(user),
        {
          OR: [
            { name: { contains: likeEscape(needle), mode: "insensitive" } },
            ...(id ? [{ id }] : []),
          ],
        },
      ],
    },
    orderBy: { name: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      name: true,
      type: true,
      cultivarId: true,
      cultivar: { select: { name: true } },
      currentState: { select: { kind: true } },
      holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
    },
  });
  const hits = units.map((unit): RecallSearchHit => ({
    id: unit.id,
    name: unit.name,
    type: unit.type,
    cultivar: unit.cultivar?.name ?? null,
    cultivarId: unit.cultivarId,
    standing: unitStanding(unit.currentState?.kind, unit.holds[0]?.kind),
    nothingLeft: hasNothingLeft(unit.currentState?.kind),
  }));
  // An exact name or id first.
  const exact = (hit: RecallSearchHit) =>
    hit.id === id || hit.name.toLowerCase() === needle.toLowerCase() ? 0 : 1;
  return hits.sort((a, b) => exact(a) - exact(b));
}
