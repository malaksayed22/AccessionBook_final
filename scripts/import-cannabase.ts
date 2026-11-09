import "dotenv/config";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "../src/generated/prisma/client";
import {
  ExperimentRole,
  GrowthStage,
  HoldKind,
  HoldOrigin,
  PermissionLevel,
  SourceType,
  UnitStateKind,
  UnitType,
} from "../src/generated/prisma/enums";
import { highestCodeNumber } from "../src/lib/experiment-codes";
import { hashInviteToken } from "../src/lib/invites";
import type { SessionUser } from "../src/lib/auth";
import { logMemberActivity } from "../src/server/audit";
import { prisma } from "../src/server/db";
import { env } from "../src/server/env";
import {
  decodeHtml,
  loadCannabaseSql,
  parseDateInZone,
  parseSqlRecords,
  sha256Hex,
  type SqlRecord,
  type SqlValue,
} from "./sql-parser";

/**
 * Legacy Cannabase -> Accession Book importer (schema v3).
 *
 * Non-destructive and idempotent: nothing is truncated or deleted. Every entity is matched on its
 * natural key (user name, cultivar name, location name, organisation name, experiment code, unit
 * name) and only created when missing, so a re-run creates nothing and changes nothing. Rows that
 * already exist are never overwritten: they may carry operator edits made since the first import.
 *
 * Ids are never supplied; the legacy-id -> new-id maps live in memory for the run.
 *
 * A legacy unit is a chain of state snapshots with side tables. It becomes a unit plus immutable
 * `UnitState` events by diffing consecutive snapshots (see `planUnit`). Anything that cannot be
 * carried over is counted and listed in the report, never silently dropped.
 */

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

/**
 * dropped   - a legacy value could not be imported and was discarded (validation fails on these)
 * defaulted - imported, but a default or a merge replaced what the legacy data said
 * info      - worth knowing, nothing lost
 */
export type IssueSeverity = "dropped" | "defaulted" | "info";

export type Issue = { kind: string; severity: IssueSeverity; count: number; examples: string[] };

const MAX_EXAMPLES = 50;

export class IssueLog {
  private readonly entries = new Map<string, Issue>();

  add(kind: string, severity: IssueSeverity, detail: string): void {
    const key = `${severity}:${kind}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { kind, severity, count: 0, examples: [] };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.examples.length < MAX_EXAMPLES) entry.examples.push(detail);
  }

  list(): Issue[] {
    return [...this.entries.values()].sort(
      (a, b) => a.severity.localeCompare(b.severity) || a.kind.localeCompare(b.kind)
    );
  }
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return "No legacy values needed attention.";
  return issues
    .map((issue) => {
      const lines = issue.examples.map((example) => `      - ${example}`);
      const more = issue.count - issue.examples.length;
      if (more > 0) lines.push(`      ...and ${more} more`);
      return `  [${issue.severity}] ${issue.kind}: ${issue.count}\n${lines.join("\n")}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Value mapping
// ---------------------------------------------------------------------------------------------

const DEFAULT_DESTROY_REASON = "Imported from the legacy system (no reason recorded)";
const DEFAULT_HOLD_REASON = "Imported from the legacy system (no hold reason recorded)";

const text = (value: SqlValue | undefined): string | null => {
  if (value == null) return null;
  const result = String(value);
  return result === "" ? null : result;
};

const integer = (value: SqlValue | undefined): number | null => {
  if (value == null || typeof value === "boolean" || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(parsed) ? parsed : null;
};

const decimal = (value: SqlValue | undefined): number | null => {
  if (value == null || typeof value === "boolean" || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const flag = (value: SqlValue | undefined, fallback: boolean): boolean => {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "y", "t", "active"].includes(value.trim().toLowerCase());
};

const letters = (raw: string) => raw.toUpperCase().replace(/[^A-Z]/g, "");

export function mapPermission(raw: string | null): PermissionLevel | null {
  if (raw === null || raw.trim() === "") return PermissionLevel.REGULAR;
  const key = letters(raw);
  if (key === "ADMIN" || key === "ADMINISTRATOR") return PermissionLevel.ADMIN;
  if (["REGULAR", "USER", "MEMBER", "STANDARD", "NORMAL"].includes(key)) {
    return PermissionLevel.REGULAR;
  }
  return null;
}

export function mapUnitType(raw: string | null): UnitType | null {
  switch (raw === null ? "" : letters(raw)) {
    case "PLANT":
    case "PLANTS":
      return UnitType.PLANT;
    case "SEEDLOT":
    case "SEEDLOTS":
      return UnitType.SEEDLOT;
    case "FLOWER":
    case "FLOWERS":
      return UnitType.FLOWER;
    case "CULTURE":
    case "CULTURES":
      return UnitType.CULTURE;
    default:
      return null;
  }
}

export function mapGrowthStage(raw: string | null): GrowthStage | null {
  switch (raw === null ? "" : letters(raw)) {
    case "VEGETATIVE":
    case "VEG":
    case "VEGETATION":
      return GrowthStage.VEGETATIVE;
    case "FLOWERING":
    case "FLOWER":
    case "BLOOM":
      return GrowthStage.FLOWERING;
    case "HARVESTED":
    case "HARVEST":
      return GrowthStage.HARVESTED;
    case "DRYING":
    case "DRIED":
    case "DRY":
      return GrowthStage.DRYING;
    case "CURING":
    case "CURED":
    case "CURE":
      return GrowthStage.CURING;
    case "STORAGE":
    case "STORED":
    case "STORE":
      return GrowthStage.STORAGE;
    case "SEED":
    case "SEEDS":
      return GrowthStage.SEED;
    default:
      return null;
  }
}

/** `null` = no hold; `undefined` = a value we cannot interpret. */
export function mapHoldKind(raw: string | null): HoldKind | null | undefined {
  const trimmed = raw === null ? "" : raw.trim();
  // A numeric flag has no letters, so it is read before the word match.
  if (trimmed === "") return null;
  if (trimmed === "1") return HoldKind.HOLD;
  if (trimmed === "0") return null;
  switch (letters(trimmed)) {
    case "NONE":
    case "NO":
    case "FALSE":
    case "OK":
    case "RELEASED":
      return null;
    case "HOLD":
    case "ONHOLD":
    case "YES":
    case "TRUE":
      return HoldKind.HOLD;
    // Quarantine is not a separate kind of hold here: a quarantined legacy unit is simply on hold.
    case "QUARANTINE":
    case "QUARANTINED":
      return HoldKind.HOLD;
    default:
      return undefined;
  }
}

const roundGrams = (value: number) => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// Legacy model
// ---------------------------------------------------------------------------------------------

type LegacyUser = {
  id: number;
  name: string;
  permissions: PermissionLevel;
  email: string | null;
  active: boolean;
};
type LegacyCultivar = { id: number; name: string; comment: string | null };
type LegacyLocation = {
  id: number;
  name: string;
  address: string | null;
  comment: string | null;
  active: boolean;
};
type LegacyOrganization = {
  id: number;
  name: string;
  address: string | null;
  country: string | null;
  comment: string | null;
};
type LegacyExperiment = {
  id: number;
  ecode: string;
  name: string;
  startDate: Date;
  endDate: Date | null;
  comment: string | null;
  parentExperimentId: number | null;
  sourceUnitId: number | null;
};
type LegacyHold = { kind: HoldKind; reason: string | null; at: Date | null };
type LegacyUnit = {
  id: number;
  name: string;
  type: UnitType;
  cultivarId: number | null;
  experimentId: number | null;
  sex: string | null;
  comment: string | null;
  hold: LegacyHold | null;
  /** `Plants.humidWeight`: a unit-level weight with no date, carried on every snapshot. */
  plantHumidWeight: number | null;
  originName: string | null;
};
type LegacyState = { id: number; unitId: number; date: Date };

type Snapshot = {
  locationId: number | null;
  growthStage: GrowthStage | null;
  humidWeight: number | null;
  dryWeight: number | null;
  seedCount: number | null;
};

/** One future `UnitState` row. Legacy ids are translated to new ids when it is written. */
export type PlannedEvent = {
  kind: UnitStateKind;
  effectiveAt: Date;
  legacyStateId: number;
  recordedByLegacyUserId: number | null;
  snapshot: Snapshot;
  organizationId: number | null;
  reason: string | null;
  comment: string | null;
};

export type UnitPlan = {
  events: PlannedEvent[];
  /** Legacy state id -> index of the last event representing that snapshot. */
  eventIndexByState: Map<number, number>;
  /** Organisation the unit was first received from, if the legacy data says so. */
  providerOrganizationId: number | null;
};

type Lineage = { parentUnitId: number; parentStateId: number; comment: string | null };

type PlanLookups = {
  zone: string;
  importedAt: Date;
  storeByState: Map<number, number>;
  stageByState: Map<number, string | null>;
  hasStageTable: boolean;
  flowerByState: Map<number, { humid: number | null; dry: number | null }>;
  seedByState: Map<number, number | null>;
  receivedByState: Map<number, { organizationId: number | null; comment: string | null }>;
  sentByState: Map<number, { organizationId: number | null; comment: string | null }>;
  destroyedByState: Map<number, { comment: string | null }>;
  recordedByState: Map<number, number>;
  locationIds: Set<number>;
  organizationIds: Set<number>;
};

export type LegacyData = {
  users: LegacyUser[];
  cultivars: LegacyCultivar[];
  locations: LegacyLocation[];
  organizations: LegacyOrganization[];
  experiments: LegacyExperiment[];
  units: LegacyUnit[];
  plans: Map<number, UnitPlan>;
  lineage: Map<number, Lineage>;
  /** Parents before children. Only units that can actually be imported. */
  unitOrder: number[];
  /** Merged duplicates: legacy id -> the legacy id that represents it. */
  alias: Record<
    "user" | "cultivar" | "location" | "organization" | "experiment",
    Map<number, number>
  >;
  issues: IssueLog;
  stats: {
    legacyUnits: number;
    legacyStates: number;
    plannedEvents: Record<string, number>;
  };
};

function dedupe<T extends { id: number }>(
  items: T[],
  keyOf: (item: T) => string,
  kind: string,
  issues: IssueLog
): { unique: T[]; alias: Map<number, number> } {
  const first = new Map<string, T>();
  const alias = new Map<number, number>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const kept = first.get(key);
    if (kept) {
      alias.set(item.id, kept.id);
      issues.add(
        kind,
        "dropped",
        `"${key}" (legacy id ${item.id}) merged into legacy id ${kept.id}`
      );
    } else {
      first.set(key, item);
      unique.push(item);
    }
  }
  return { unique, alias };
}

/** Parses the dump and plans every unit. Pure: touches no database. */
export function readLegacy(sql: string, options: { timeZone: string; now: Date }): LegacyData {
  const issues = new IssueLog();
  const { timeZone: zone, now: importedAt } = options;
  const when = (value: SqlValue | undefined) => parseDateInZone(value, zone);
  const completedOn = (date: Date | null) => (date && date.getTime() <= Date.now() ? date : null);

  // --- reference data -------------------------------------------------------------------------
  const userRows = parseSqlRecords(sql, "Users", [
    "id",
    "name",
    "password",
    "permissions",
    "email",
    "active",
  ]);
  const usersRead: LegacyUser[] = [];
  for (const r of userRows) {
    const id = integer(r.id);
    const name = text(r.name)?.trim();
    if (id === null || !name) {
      issues.add("row-without-key", "dropped", `Users row ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    const rawPermission = text(r.permissions);
    let permissions = mapPermission(rawPermission);
    if (permissions === null) {
      issues.add(
        "unknown-permission",
        "defaulted",
        `${name}: "${rawPermission}" imported as REGULAR`
      );
      permissions = PermissionLevel.REGULAR;
    }
    usersRead.push({
      id,
      name,
      permissions,
      email: text(r.email)?.trim() || null,
      active: flag(r.active, true),
    });
  }
  const users = dedupe(usersRead, (u) => u.name.toLowerCase(), "duplicate-user-name", issues);
  const seenEmails = new Map<string, string>();
  for (const user of users.unique) {
    if (!user.email) continue;
    const key = user.email.toLowerCase();
    const owner = seenEmails.get(key);
    if (owner) {
      issues.add(
        "duplicate-email",
        "dropped",
        `${user.name}: ${user.email} already used by ${owner}`
      );
      user.email = null;
    } else {
      seenEmails.set(key, user.name);
    }
  }

  const cultivarsRead: LegacyCultivar[] = [];
  for (const r of parseSqlRecords(sql, "Cultivars", ["id", "name", "comment"])) {
    const id = integer(r.id);
    const name = text(r.name)?.trim();
    if (id === null || !name) {
      issues.add("row-without-key", "dropped", `Cultivars row ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    cultivarsRead.push({ id, name: decodeHtml(name)!, comment: decodeHtml(text(r.comment)) });
  }
  const cultivars = dedupe(
    cultivarsRead,
    (c) => c.name.toLowerCase(),
    "duplicate-cultivar",
    issues
  );

  const locationsRead: LegacyLocation[] = [];
  for (const r of parseSqlRecords(sql, "Locations", [
    "id",
    "name",
    "address",
    "comment",
    "active",
  ])) {
    const id = integer(r.id);
    const name = text(r.name)?.trim();
    if (id === null || !name) {
      issues.add("row-without-key", "dropped", `Locations row ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    locationsRead.push({
      id,
      name,
      address: text(r.address),
      comment: decodeHtml(text(r.comment)),
      active: flag(r.active, true),
    });
  }
  const locations = dedupe(
    locationsRead,
    (l) => l.name.toLowerCase(),
    "duplicate-location",
    issues
  );

  const organizationsRead: LegacyOrganization[] = [];
  for (const r of parseSqlRecords(
    sql,
    ["Organizations", "Partners"],
    ["id", "name", "address", "country", "comment"]
  )) {
    const id = integer(r.id);
    const name = text(r.name)?.trim();
    if (id === null || !name) {
      issues.add(
        "row-without-key",
        "dropped",
        `Organizations row ${JSON.stringify(r).slice(0, 80)}`
      );
      continue;
    }
    organizationsRead.push({
      id,
      name,
      address: text(r.address),
      country: text(r.country),
      comment: decodeHtml(text(r.comment)),
    });
  }
  const organizations = dedupe(
    organizationsRead,
    (o) => o.name.toLowerCase(),
    "duplicate-organization",
    issues
  );

  const canon = (aliases: Map<number, number>, id: number | null) =>
    id === null ? null : (aliases.get(id) ?? id);
  const cultivarIds = new Set(cultivars.unique.map((c) => c.id));
  const locationIds = new Set(locations.unique.map((l) => l.id));
  const organizationIds = new Set(organizations.unique.map((o) => o.id));

  // --- experiments ----------------------------------------------------------------------------
  const experimentsRead: LegacyExperiment[] = [];
  for (const r of parseSqlRecords(sql, "Experiments", [
    "id",
    "ecode",
    "name",
    "startdate",
    "enddate",
    "comment",
    "parentexperimentid",
    "sourceunitid",
  ])) {
    const id = integer(r.id);
    const ecode = text(r.ecode)?.trim();
    if (id === null || !ecode) {
      issues.add("row-without-key", "dropped", `Experiments row ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    let startDate = when(r.startdate);
    if (!startDate) {
      issues.add(
        "invalid-date",
        "defaulted",
        `Experiment ${ecode}: start date "${r.startdate}" replaced by the import time`
      );
      startDate = importedAt;
    }
    experimentsRead.push({
      id,
      ecode,
      name: decodeHtml(text(r.name)) ?? ecode,
      startDate,
      // A legacy end date in the future was a plan, not a completion: the experiment still runs.
      endDate: completedOn(when(r.enddate)),
      comment: decodeHtml(text(r.comment)),
      parentExperimentId: integer(r.parentexperimentid),
      sourceUnitId: integer(r.sourceunitid),
    });
  }
  const experiments = dedupe(experimentsRead, (e) => e.ecode, "duplicate-experiment-code", issues);
  const experimentIds = new Set(experiments.unique.map((e) => e.id));

  // --- units ----------------------------------------------------------------------------------
  const plantRows = new Map<number, SqlRecord>();
  for (const r of parseSqlRecords(sql, "Plants", ["id", "humidweight", "originname"])) {
    const id = integer(r.id);
    if (id !== null) plantRows.set(id, r);
  }

  const unitsRead: LegacyUnit[] = [];
  for (const r of parseSqlRecords(sql, "BiologicalUnits", [
    "id",
    "name",
    "cultivarid",
    "sex",
    "type",
    "experimentid",
    "comment",
    "holdstatus",
    "holdreason",
    "holdat",
  ])) {
    const id = integer(r.id);
    const name = text(r.name)?.trim();
    if (id === null || !name) {
      issues.add(
        "row-without-key",
        "dropped",
        `BiologicalUnits row ${JSON.stringify(r).slice(0, 80)}`
      );
      continue;
    }
    const type = mapUnitType(text(r.type));
    if (!type) {
      issues.add("unknown-unit-type", "dropped", `${name}: type "${r.type}" - unit not imported`);
      continue;
    }

    let cultivarId = canon(cultivars.alias, integer(r.cultivarid));
    if (cultivarId !== null && !cultivarIds.has(cultivarId)) {
      issues.add("unknown-cultivar", "dropped", `${name}: cultivar ${cultivarId} does not exist`);
      cultivarId = null;
    }
    let experimentId = canon(experiments.alias, integer(r.experimentid));
    if (experimentId !== null && !experimentIds.has(experimentId)) {
      issues.add(
        "unknown-experiment",
        "dropped",
        `${name}: experiment ${experimentId} does not exist`
      );
      experimentId = null;
    }

    let hold: LegacyHold | null = null;
    const holdKind = mapHoldKind(text(r.holdstatus));
    if (holdKind === undefined) {
      issues.add("unknown-hold-status", "dropped", `${name}: hold status "${r.holdstatus}"`);
    } else if (holdKind) {
      hold = { kind: holdKind, reason: decodeHtml(text(r.holdreason)), at: when(r.holdat) };
    }

    const plantRow = plantRows.get(id);
    let plantHumidWeight = plantRow ? decimal(plantRow.humidweight) : null;
    if (plantHumidWeight !== null && plantHumidWeight < 0) {
      issues.add("negative-quantity", "dropped", `${name}: plant weight ${plantHumidWeight}`);
      plantHumidWeight = null;
    }

    unitsRead.push({
      id,
      name,
      type,
      cultivarId,
      experimentId,
      sex: text(r.sex),
      comment: decodeHtml(text(r.comment)),
      hold,
      plantHumidWeight: plantHumidWeight === null ? null : roundGrams(plantHumidWeight),
      originName: plantRow ? (text(plantRow.originname) ?? null) : null,
    });
  }
  const unitsByName = dedupe(unitsRead, (u) => u.name, "duplicate-unit-name", issues);
  const caseFolded = new Map<string, string>();
  for (const unit of unitsByName.unique) {
    const key = unit.name.toLowerCase();
    const other = caseFolded.get(key);
    if (other) {
      issues.add(
        "unit-name-case-collision",
        "defaulted",
        `"${unit.name}" and "${other}" differ only by case`
      );
    } else {
      caseFolded.set(key, unit.name);
    }
  }

  // --- states and their side tables -----------------------------------------------------------
  const stateRows = parseSqlRecords(sql, "States", ["id", "type", "date", "unitid"]);
  const unitById = new Map(unitsByName.unique.map((u) => [u.id, u]));
  const droppedUnitIds = new Set(unitsRead.filter((u) => !unitById.has(u.id)).map((u) => u.id));
  const statesByUnit = new Map<number, Array<{ id: number; date: Date | null }>>();
  const stateIds = new Map<number, number>();
  for (const r of stateRows) {
    const id = integer(r.id);
    const unitId = integer(r.unitid);
    if (id === null || unitId === null) {
      issues.add("row-without-key", "dropped", `States row ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    stateIds.set(id, unitId);
    if (!unitById.has(unitId)) {
      // States of units that were themselves reported (or merged) are covered by that report.
      if (!droppedUnitIds.has(unitId)) {
        issues.add("orphan-state", "dropped", `State ${id} belongs to unknown unit ${unitId}`);
      }
      continue;
    }
    const chain = statesByUnit.get(unitId) ?? [];
    chain.push({ id, date: when(r.date) });
    statesByUnit.set(unitId, chain);
  }

  const storeByState = new Map<number, number>();
  for (const r of parseSqlRecords(sql, "Stores", ["stateid", "locationid"])) {
    const stateId = integer(r.stateid);
    const locationId = canon(locations.alias, integer(r.locationid));
    if (stateId !== null && locationId !== null) storeByState.set(stateId, locationId);
  }

  const stageRows = parseSqlRecords(sql, "PlantStates", ["id", "growthstage"]);
  const stageByState = new Map<number, string | null>();
  for (const r of stageRows) {
    const id = integer(r.id);
    if (id !== null) stageByState.set(id, text(r.growthstage));
  }

  const flowerByState = new Map<number, { humid: number | null; dry: number | null }>();
  for (const r of parseSqlRecords(sql, "FlowerStates", ["id", "humidweight", "dryweight"])) {
    const id = integer(r.id);
    if (id !== null)
      flowerByState.set(id, { humid: decimal(r.humidweight), dry: decimal(r.dryweight) });
  }

  const seedByState = new Map<number, number | null>();
  for (const r of parseSqlRecords(sql, "SeedLotStates", ["id", "seedcount"])) {
    const id = integer(r.id);
    if (id !== null) seedByState.set(id, decimal(r.seedcount));
  }

  const counterparties = (table: string) => {
    const result = new Map<number, { organizationId: number | null; comment: string | null }>();
    for (const r of parseSqlRecords(sql, table, ["stateid", "organizationid", "date", "comment"])) {
      const stateId = integer(r.stateid);
      if (stateId === null || result.has(stateId)) continue;
      const organizationId = canon(organizations.alias, integer(r.organizationid));
      result.set(stateId, {
        organizationId,
        comment: decodeHtml(text(r.comment)),
      });
    }
    return result;
  };
  const receivedByState = counterparties("ReceivedFrom");
  const sentByState = counterparties("SentTo");

  const destroyedByState = new Map<number, { comment: string | null }>();
  for (const r of parseSqlRecords(sql, "Destroyed", ["stateid", "date", "comment"])) {
    const stateId = integer(r.stateid);
    if (stateId !== null && !destroyedByState.has(stateId)) {
      destroyedByState.set(stateId, { comment: decodeHtml(text(r.comment)) });
    }
  }

  const recordedByState = new Map<number, number>();
  for (const r of parseSqlRecords(sql, "StateRecords", ["stateid", "userid", "savedate"])) {
    const stateId = integer(r.stateid);
    const userId = canon(users.alias, integer(r.userid));
    if (stateId !== null && userId !== null && !recordedByState.has(stateId)) {
      recordedByState.set(stateId, userId);
    }
  }

  // --- plan every unit's event chain ----------------------------------------------------------
  const lookups: PlanLookups = {
    zone,
    importedAt,
    storeByState,
    stageByState,
    hasStageTable: stageRows.length > 0,
    flowerByState,
    seedByState,
    receivedByState,
    sentByState,
    destroyedByState,
    recordedByState,
    locationIds,
    organizationIds,
  };

  const plans = new Map<number, UnitPlan>();
  const importableUnits: LegacyUnit[] = [];
  let legacyStates = 0;
  const plannedEvents: Record<string, number> = {};
  for (const unit of unitsByName.unique) {
    const chain = orderChain(unit, statesByUnit.get(unit.id) ?? [], importedAt, issues);
    legacyStates += chain.length;
    if (chain.length === 0) {
      issues.add(
        "unit-without-states",
        "dropped",
        `${unit.name}: no state recorded - unit not imported`
      );
      continue;
    }
    const plan = planUnit(unit, chain, lookups, issues);
    plans.set(unit.id, plan);
    importableUnits.push(unit);
    for (const event of plan.events)
      plannedEvents[event.kind] = (plannedEvents[event.kind] ?? 0) + 1;
  }

  // --- lineage --------------------------------------------------------------------------------
  const lineage = new Map<number, Lineage>();
  for (const r of parseSqlRecords(sql, "Manipulations", ["parentid", "childid", "comment"])) {
    const parentStateId = integer(r.parentid);
    const childStateId = integer(r.childid);
    const label = `state ${parentStateId} -> state ${childStateId}`;
    if (parentStateId === null || childStateId === null) {
      issues.add("lineage-missing-state", "dropped", `Manipulation ${label}`);
      continue;
    }
    const parentUnitId = stateIds.get(parentStateId);
    const childUnitId = stateIds.get(childStateId);
    if (parentUnitId === undefined || childUnitId === undefined) {
      issues.add(
        "lineage-missing-state",
        "dropped",
        `Manipulation ${label}: a state does not exist`
      );
      continue;
    }
    if (parentUnitId === childUnitId) {
      issues.add(
        "lineage-within-unit",
        "info",
        `Manipulation ${label} stays inside unit ${parentUnitId}`
      );
      continue;
    }
    if (!plans.has(parentUnitId) || !plans.has(childUnitId)) {
      issues.add(
        "lineage-unit-not-imported",
        "dropped",
        `Manipulation ${label}: a unit was not imported`
      );
      continue;
    }
    if (lineage.has(childUnitId)) {
      issues.add(
        "multiple-parents",
        "dropped",
        `${unitById.get(childUnitId)?.name}: extra parent link ${label}`
      );
      continue;
    }
    lineage.set(childUnitId, {
      parentUnitId,
      parentStateId,
      comment: decodeHtml(text(r.comment)),
    });
  }

  const unitOrder = orderParentsFirst(
    importableUnits.map((u) => u.id),
    lineage,
    (child, parent) =>
      issues.add(
        "lineage-cycle",
        "dropped",
        `${unitById.get(child)?.name} -> ${unitById.get(parent)?.name}: parent link removed to break a cycle`
      )
  );

  return {
    users: users.unique,
    cultivars: cultivars.unique,
    locations: locations.unique,
    organizations: organizations.unique,
    experiments: experiments.unique,
    units: importableUnits,
    plans,
    lineage,
    unitOrder,
    alias: {
      user: users.alias,
      cultivar: cultivars.alias,
      location: locations.alias,
      organization: organizations.alias,
      experiment: experiments.alias,
    },
    issues,
    stats: { legacyUnits: unitsRead.length, legacyStates, plannedEvents },
  };
}

/** Sorts a unit's states by date (then id); a state with no usable date inherits its neighbour's. */
function orderChain(
  unit: LegacyUnit,
  states: Array<{ id: number; date: Date | null }>,
  importedAt: Date,
  issues: IssueLog
): LegacyState[] {
  if (states.length === 0) return [];
  const byId = [...states].sort((a, b) => a.id - b.id);
  const firstValid = byId.find((s) => s.date)?.date ?? importedAt;
  let previous = firstValid;
  const dated = byId.map((state) => {
    if (state.date) {
      previous = state.date;
      return { id: state.id, unitId: unit.id, date: state.date };
    }
    issues.add(
      "invalid-date",
      "defaulted",
      `${unit.name}: state ${state.id} has no usable date, using ${previous.toISOString()}`
    );
    return { id: state.id, unitId: unit.id, date: previous };
  });
  return dated.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id - b.id);
}

/** Parents before children; a cycle is broken by removing the offending parent link. */
function orderParentsFirst(
  unitIds: number[],
  parentOf: Map<number, Lineage>,
  onCycle: (child: number, parent: number) => void
): number[] {
  const order: number[] = [];
  const done = new Set<number>();
  for (const start of [...unitIds].sort((a, b) => a - b)) {
    const path: number[] = [];
    const onPath = new Set<number>();
    let cursor: number | undefined = start;
    while (cursor !== undefined && !done.has(cursor)) {
      if (onPath.has(cursor)) {
        const last = path[path.length - 1]!;
        onCycle(last, cursor);
        parentOf.delete(last);
        break;
      }
      onPath.add(cursor);
      path.push(cursor);
      cursor = parentOf.get(cursor)?.parentUnitId;
    }
    for (const id of path.reverse()) {
      order.push(id);
      done.add(id);
    }
  }
  return order;
}

/**
 * Turns a unit's snapshot chain into events.
 *
 *  - first snapshot            -> CREATED, or RECEIVED when it has a ReceivedFrom record
 *  - location changed          -> MOVED
 *  - growth stage changed      -> STAGE_CHANGED
 *  - weight / seed count change-> MEASURED
 *  - Destroyed / SentTo record -> DESTROYED / SHIPPED (terminal; later snapshots are reported)
 *
 * A value the legacy snapshot does not state is carried forward, never read as "cleared".
 */
export function planUnit(
  unit: LegacyUnit,
  chain: LegacyState[],
  lookups: PlanLookups,
  issues: IssueLog
): UnitPlan {
  const events: PlannedEvent[] = [];
  const eventIndexByState = new Map<number, number>();
  let providerOrganizationId: number | null = null;
  let snapshot: Snapshot = {
    locationId: null,
    growthStage: null,
    humidWeight: null,
    dryWeight: null,
    seedCount: null,
  };
  let terminal = false;

  chain.forEach((state, position) => {
    if (terminal) {
      issues.add(
        "state-after-terminal",
        "dropped",
        `${unit.name}: state ${state.id} follows a destroyed/shipped state`
      );
      return;
    }

    const incoming = readSnapshot(unit, state, lookups, issues);
    const recordedByLegacyUserId = lookups.recordedByState.get(state.id) ?? null;
    const emit = (
      kind: UnitStateKind,
      extra: Partial<Pick<PlannedEvent, "organizationId" | "reason" | "comment">> = {}
    ) => {
      events.push({
        kind,
        effectiveAt: state.date,
        legacyStateId: state.id,
        recordedByLegacyUserId,
        snapshot: { ...snapshot },
        organizationId: extra.organizationId ?? null,
        reason: extra.reason ?? null,
        comment: extra.comment ?? null,
      });
    };

    const received = lookups.receivedByState.get(state.id);
    if (received) {
      if (
        received.organizationId !== null &&
        !lookups.organizationIds.has(received.organizationId)
      ) {
        issues.add(
          "unknown-organization",
          "dropped",
          `${unit.name}: received-from organization ${received.organizationId}`
        );
        received.organizationId = null;
      }
      providerOrganizationId ??= received.organizationId;
    }

    if (position === 0) {
      snapshot = {
        locationId: incoming.locationId ?? null,
        growthStage: incoming.growthStage ?? null,
        humidWeight: incoming.humidWeight ?? null,
        dryWeight: incoming.dryWeight ?? null,
        seedCount: incoming.seedCount ?? null,
      };
      emit(received ? UnitStateKind.RECEIVED : UnitStateKind.CREATED, {
        organizationId: received?.organizationId ?? null,
        comment: received?.comment ?? null,
      });
    } else {
      if (received) {
        issues.add(
          "received-after-creation",
          "info",
          `${unit.name}: ReceivedFrom on a later state is kept as provenance only`
        );
      }
      if (incoming.locationId != null && incoming.locationId !== snapshot.locationId) {
        snapshot = { ...snapshot, locationId: incoming.locationId };
        emit(UnitStateKind.MOVED);
      }
      if (incoming.growthStage != null && incoming.growthStage !== snapshot.growthStage) {
        snapshot = { ...snapshot, growthStage: incoming.growthStage };
        emit(UnitStateKind.STAGE_CHANGED);
      }
      const measured: Partial<Snapshot> = {};
      if (incoming.humidWeight != null && incoming.humidWeight !== snapshot.humidWeight) {
        measured.humidWeight = incoming.humidWeight;
      }
      if (incoming.dryWeight != null && incoming.dryWeight !== snapshot.dryWeight) {
        measured.dryWeight = incoming.dryWeight;
      }
      if (incoming.seedCount != null && incoming.seedCount !== snapshot.seedCount) {
        measured.seedCount = incoming.seedCount;
      }
      if (Object.keys(measured).length > 0) {
        snapshot = { ...snapshot, ...measured };
        emit(UnitStateKind.MEASURED);
      }
    }

    const destroyed = lookups.destroyedByState.get(state.id);
    const sent = lookups.sentByState.get(state.id);
    if (destroyed) {
      if (sent) {
        issues.add(
          "destroyed-and-sent",
          "dropped",
          `${unit.name}: state ${state.id} is both destroyed and sent; SentTo ignored`
        );
      }
      const reason = destroyed.comment?.trim();
      if (!reason) {
        issues.add(
          "destroyed-without-reason",
          "defaulted",
          `${unit.name}: default reason recorded`
        );
      }
      emit(UnitStateKind.DESTROYED, { reason: reason || DEFAULT_DESTROY_REASON });
      terminal = true;
    } else if (sent) {
      let organizationId = sent.organizationId;
      if (organizationId !== null && !lookups.organizationIds.has(organizationId)) {
        issues.add(
          "unknown-organization",
          "dropped",
          `${unit.name}: sent-to organization ${organizationId}`
        );
        organizationId = null;
      }
      emit(UnitStateKind.SHIPPED, { organizationId, comment: sent.comment });
      terminal = true;
    }

    // Every snapshot maps to the last event written up to and including it.
    eventIndexByState.set(state.id, events.length - 1);
  });

  return { events, eventIndexByState, providerOrganizationId };
}

type IncomingSnapshot = { [K in keyof Snapshot]?: Snapshot[K] };

function readSnapshot(
  unit: LegacyUnit,
  state: LegacyState,
  lookups: PlanLookups,
  issues: IssueLog
): IncomingSnapshot {
  const incoming: IncomingSnapshot = {};

  const locationId = lookups.storeByState.get(state.id);
  if (locationId !== undefined) {
    if (lookups.locationIds.has(locationId)) incoming.locationId = locationId;
    else
      issues.add(
        "unknown-location",
        "dropped",
        `${unit.name}: state ${state.id} location ${locationId}`
      );
  }

  if (lookups.stageByState.has(state.id)) {
    const raw = lookups.stageByState.get(state.id) ?? null;
    const stage = mapGrowthStage(raw);
    if (stage) incoming.growthStage = stage;
    else if (raw !== null) {
      issues.add(
        "unknown-growth-stage",
        "dropped",
        `${unit.name}: state ${state.id} stage "${raw}"`
      );
    }
  } else if (!lookups.hasStageTable && unit.type === UnitType.PLANT) {
    incoming.growthStage = GrowthStage.VEGETATIVE;
    issues.add(
      "defaulted-growth-stage",
      "info",
      `${unit.name}: state ${state.id} has no PlantStates table`
    );
  }

  const quantity = (value: number | null, label: string): number | undefined => {
    if (value === null) return undefined;
    if (value < 0) {
      issues.add(
        "negative-quantity",
        "dropped",
        `${unit.name}: state ${state.id} ${label} ${value}`
      );
      return undefined;
    }
    return value;
  };
  const flower = lookups.flowerByState.get(state.id);
  const humid = quantity(flower?.humid ?? unit.plantHumidWeight, "humid weight");
  const dry = quantity(flower?.dry ?? null, "dry weight");
  if (humid !== undefined) incoming.humidWeight = roundGrams(humid);
  if (dry !== undefined) incoming.dryWeight = roundGrams(dry);

  const seeds = quantity(lookups.seedByState.get(state.id) ?? null, "seed count");
  if (seeds !== undefined) incoming.seedCount = Math.round(seeds);

  return incoming;
}

// ---------------------------------------------------------------------------------------------
// Analysis (no database)
// ---------------------------------------------------------------------------------------------

export type Analysis = {
  checksum: string;
  issues: Issue[];
  legacy: LegacyData;
};

/** Everything the importer would do and every value it cannot carry over, without writing. */
export function analyzeCannabase(sql: string, options: { timeZone: string; now?: Date }): Analysis {
  const legacy = readLegacy(sql, { timeZone: options.timeZone, now: options.now ?? new Date() });
  return { checksum: sha256Hex(sql), issues: legacy.issues.list(), legacy };
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

export type EntityCounts = {
  users: number;
  cultivars: number;
  locations: number;
  organizations: number;
  experiments: number;
  experimentMembers: number;
  units: number;
  states: number;
  holds: number;
  codeCounters: number;
};

const emptyCounts = (): EntityCounts => ({
  users: 0,
  cultivars: 0,
  locations: 0,
  organizations: 0,
  experiments: 0,
  experimentMembers: 0,
  units: 0,
  states: 0,
  holds: 0,
  codeCounters: 0,
});

export type ImportOptions = {
  sql: string;
  /** The administrator running the import; must exist, be active and be an ADMIN. */
  actor: SessionUser;
  allowProduction?: boolean;
  /** Overrides `process.env.NODE_ENV` (tests). */
  nodeEnv?: string;
  /** Zone the legacy wall-clock timestamps are in. Defaults to LAB_TIMEZONE. */
  timeZone?: string;
  /** Import time; recordedAt of every event. Defaults to now. */
  now?: Date;
  /** Units written per transaction. A unit and all its states are never split. */
  batchSize?: number;
  log?: (message: string) => void;
};

export type ImportResult = {
  checksum: string;
  created: EntityCounts;
  existing: EntityCounts;
  issues: Issue[];
};

type Tx = Prisma.TransactionClient;

const TRANSACTION = { timeout: 120_000, maxWait: 15_000 } as const;

type IdMaps = {
  user: Map<number, number>;
  cultivar: Map<number, number>;
  location: Map<number, number>;
  organization: Map<number, number>;
  experiment: Map<number, number>;
  unit: Map<number, number>;
  /** Legacy state id -> the new UnitState id that represents it. */
  state: Map<number, number>;
  /** Legacy unit id -> its newest new state id. */
  lastState: Map<number, number>;
};

const TEAM_PATTERNS: Array<{ pattern: RegExp; userName: string }> = [
  { pattern: /Kimy-Li/i, userName: "Kimy-Li" },
  { pattern: /Kevin Dragan/i, userName: "Kevin" },
  { pattern: /Justine Richard-Giroux|Justine RG|Justine,/i, userName: "Justine" },
  { pattern: /Ladan/i, userName: "Ladan" },
  { pattern: /Julien/i, userName: "Julien Roy" },
  { pattern: /Hélène|Helene/i, userName: "Helene" },
  { pattern: /Sarah Gulsoy/i, userName: "Sarah Gulsoy" },
  { pattern: /Kubra Budak/i, userName: "Kubra Budak Tek" },
  { pattern: /Véronique|Veronique/i, userName: "Veronique" },
  { pattern: /Eliana/i, userName: "Eliana" },
  { pattern: /Alexis Boily/i, userName: "Alexis" },
  { pattern: /Jacob Hergott/i, userName: "Jacob" },
  { pattern: /Davoud/i, userName: "Davoud" },
];

/**
 * Team members named in an experiment's comment, in order of appearance. The first named person
 * is taken as the lead, the rest as members.
 */
export function inferTeamFromComment(
  comment: string | null,
  userIdByName: Map<string, number>
): Array<{ userId: number; role: ExperimentRole }> {
  if (!comment) return [];
  const found: Array<{ userId: number; position: number }> = [];
  for (const { pattern, userName } of TEAM_PATTERNS) {
    const userId = userIdByName.get(userName.toLowerCase());
    const position = comment.search(pattern);
    if (userId !== undefined && position >= 0 && !found.some((f) => f.userId === userId)) {
      found.push({ userId, position });
    }
  }
  found.sort((a, b) => a.position - b.position);
  return found.map((f, index) => ({
    userId: f.userId,
    role: index === 0 ? ExperimentRole.LEAD : ExperimentRole.MEMBER,
  }));
}

async function verifyActor(actor: SessionUser): Promise<SessionUser> {
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user) throw new Error(`Actor "${actor.name}" does not exist.`);
  if (!user.active || user.permissions !== PermissionLevel.ADMIN) {
    throw new Error(`Actor "${user.name}" must be an active administrator.`);
  }
  return { id: user.id, name: user.name, permissions: user.permissions };
}

const countChange = (field: string, to: number) => ({ field, from: null, to: String(to) });

async function auditSummary(
  tx: Tx,
  actor: SessionUser,
  entityType: string,
  label: string,
  summary: string,
  changes: Array<{ field: string; from: null; to: string }>
) {
  await logMemberActivity(
    actor,
    { entityType, entityId: 0, entityLabel: label, action: "import", summary, changes },
    tx
  );
}

export async function importCannabase(options: ImportOptions): Promise<ImportResult> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "production" && !options.allowProduction) {
    throw new Error(
      "Refusing to run the legacy import with NODE_ENV=production. Pass --allow-production."
    );
  }
  const log = options.log ?? (() => {});
  const actor = await verifyActor(options.actor);
  const importedAt = options.now ?? new Date();
  const checksum = sha256Hex(options.sql);
  const legacy = readLegacy(options.sql, {
    timeZone: options.timeZone ?? env().LAB_TIMEZONE,
    now: importedAt,
  });
  const issues = legacy.issues;
  const created = emptyCounts();
  const existing = emptyCounts();
  const maps: IdMaps = {
    user: new Map(),
    cultivar: new Map(),
    location: new Map(),
    organization: new Map(),
    experiment: new Map(),
    unit: new Map(),
    state: new Map(),
    lastState: new Map(),
  };

  log(`Dump checksum ${checksum}`);
  log("Importing members, reference data and experiments...");
  await prisma.$transaction(
    (tx) => importReferenceData(tx, { legacy, actor, importedAt, maps, created, existing, issues }),
    TRANSACTION
  );

  log(`Importing ${legacy.unitOrder.length} units...`);
  const unitById = new Map(legacy.units.map((u) => [u.id, u]));
  const batchSize = Math.max(1, options.batchSize ?? 100);
  const preexisting = new Map(
    (await prisma.biologicalUnit.findMany({ select: { id: true, name: true } })).map((u) => [
      u.name,
      u.id,
    ])
  );
  const batches: number[][] = [];
  for (let i = 0; i < legacy.unitOrder.length; i += batchSize) {
    batches.push(legacy.unitOrder.slice(i, i + batchSize));
  }
  for (const [index, batch] of batches.entries()) {
    await prisma.$transaction(async (tx) => {
      const before = { ...created };
      for (const legacyUnitId of batch) {
        const unit = unitById.get(legacyUnitId)!;
        await importUnit(tx, unit, {
          legacy,
          unitById,
          actor,
          importedAt,
          maps,
          created,
          existing,
          preexisting,
        });
      }
      const units = created.units - before.units;
      if (units > 0) {
        await auditSummary(
          tx,
          actor,
          "unit",
          "Cannabase import: units",
          `Imported ${units} units with ${created.states - before.states} state events from the legacy system (batch ${index + 1} of ${batches.length})`,
          [
            countChange("units", units),
            countChange("states", created.states - before.states),
            countChange("holds", created.holds - before.holds),
          ]
        );
      }
    }, TRANSACTION);
  }

  log("Linking experiments to their source units...");
  await prisma.$transaction(async (tx) => {
    await linkExperimentSourceUnits(tx, legacy, maps);
    await auditSummary(
      tx,
      actor,
      "import",
      "Cannabase import",
      `Legacy import finished (dump sha256 ${checksum})`,
      [
        { field: "checksum", from: null, to: checksum },
        ...Object.entries(created).map(([field, count]) => countChange(`created.${field}`, count)),
        ...Object.entries(existing).map(([field, count]) =>
          countChange(`existing.${field}`, count)
        ),
        ...issues
          .list()
          .map((issue) => countChange(`issue.${issue.severity}.${issue.kind}`, issue.count)),
      ]
    );
  }, TRANSACTION);

  return { checksum, created, existing, issues: issues.list() };
}

type ReferenceContext = {
  legacy: LegacyData;
  actor: SessionUser;
  importedAt: Date;
  maps: IdMaps;
  created: EntityCounts;
  existing: EntityCounts;
  issues: IssueLog;
};

async function importReferenceData(tx: Tx, ctx: ReferenceContext) {
  const { legacy, actor, importedAt, maps, created, existing, issues } = ctx;

  // Members: pending invitations (or deactivated), never a password.
  const knownUsers = await tx.user.findMany({ select: { id: true, name: true, email: true } });
  const userByLowerName = new Map(knownUsers.map((u) => [u.name.toLowerCase(), u.id]));
  const takenEmails = new Set(knownUsers.flatMap((u) => (u.email ? [u.email.toLowerCase()] : [])));
  for (const user of legacy.users) {
    const found = userByLowerName.get(user.name.toLowerCase());
    if (found !== undefined) {
      maps.user.set(user.id, found);
      existing.users += 1;
      continue;
    }
    let email = user.email;
    if (email && takenEmails.has(email.toLowerCase())) {
      issues.add(
        "duplicate-email",
        "dropped",
        `${user.name}: ${email} already belongs to another member`
      );
      email = null;
    }
    if (email) takenEmails.add(email.toLowerCase());
    const row = await tx.user.create({
      data: {
        name: user.name,
        passwordHash: "",
        permissions: user.permissions,
        email,
        active: false,
        ...(user.active
          ? {
              inviteTokenHash: hashInviteToken(randomBytes(32).toString("base64url")),
              inviteExpiresAt: new Date(0),
              invitedById: actor.id,
              invitedAt: importedAt,
            }
          : {}),
      },
    });
    maps.user.set(user.id, row.id);
    userByLowerName.set(user.name.toLowerCase(), row.id);
    created.users += 1;
  }
  for (const [duplicate, kept] of legacy.alias.user) {
    const id = maps.user.get(kept);
    if (id !== undefined) maps.user.set(duplicate, id);
  }

  const cultivarByName = new Map(
    (await tx.cultivar.findMany({ select: { id: true, name: true } })).map((c) => [
      c.name.toLowerCase(),
      c.id,
    ])
  );
  for (const cultivar of legacy.cultivars) {
    const found = cultivarByName.get(cultivar.name.toLowerCase());
    if (found !== undefined) {
      maps.cultivar.set(cultivar.id, found);
      existing.cultivars += 1;
      continue;
    }
    const row = await tx.cultivar.create({
      data: { name: cultivar.name, comment: cultivar.comment },
    });
    maps.cultivar.set(cultivar.id, row.id);
    created.cultivars += 1;
  }
  for (const [duplicate, kept] of legacy.alias.cultivar) {
    const id = maps.cultivar.get(kept);
    if (id !== undefined) maps.cultivar.set(duplicate, id);
  }

  const locationByName = new Map(
    (await tx.location.findMany({ select: { id: true, name: true } })).map((l) => [
      l.name.toLowerCase(),
      l.id,
    ])
  );
  for (const location of legacy.locations) {
    const found = locationByName.get(location.name.toLowerCase());
    if (found !== undefined) {
      maps.location.set(location.id, found);
      existing.locations += 1;
      continue;
    }
    const row = await tx.location.create({
      data: {
        name: location.name,
        address: location.address,
        comment: location.comment,
        active: location.active,
      },
    });
    maps.location.set(location.id, row.id);
    created.locations += 1;
  }
  for (const [duplicate, kept] of legacy.alias.location) {
    const id = maps.location.get(kept);
    if (id !== undefined) maps.location.set(duplicate, id);
  }

  const organizationByName = new Map(
    (await tx.organization.findMany({ select: { id: true, name: true } })).map((o) => [
      o.name.toLowerCase(),
      o.id,
    ])
  );
  for (const organization of legacy.organizations) {
    const found = organizationByName.get(organization.name.toLowerCase());
    if (found !== undefined) {
      maps.organization.set(organization.id, found);
      existing.organizations += 1;
      continue;
    }
    const row = await tx.organization.create({
      data: {
        name: organization.name,
        address: organization.address,
        country: organization.country,
        comment: organization.comment,
      },
    });
    maps.organization.set(organization.id, row.id);
    created.organizations += 1;
  }
  for (const [duplicate, kept] of legacy.alias.organization) {
    const id = maps.organization.get(kept);
    if (id !== undefined) maps.organization.set(duplicate, id);
  }

  // Experiments: create, then a second pass for parent links; source units come after the units.
  const knownExperiments = await tx.experiment.findMany({
    select: { id: true, ecode: true, parentExperimentId: true },
  });
  const experimentByCode = new Map(knownExperiments.map((e) => [e.ecode, e]));
  const newExperiments = new Set<number>();
  for (const experiment of legacy.experiments) {
    const found = experimentByCode.get(experiment.ecode);
    if (found) {
      maps.experiment.set(experiment.id, found.id);
      existing.experiments += 1;
      continue;
    }
    const row = await tx.experiment.create({
      data: {
        ecode: experiment.ecode,
        name: experiment.name,
        startDate: experiment.startDate,
        endDate: experiment.endDate,
        comment: experiment.comment,
      },
    });
    maps.experiment.set(experiment.id, row.id);
    newExperiments.add(row.id);
    experimentByCode.set(experiment.ecode, {
      id: row.id,
      ecode: row.ecode,
      parentExperimentId: null,
    });
    created.experiments += 1;
  }
  for (const [duplicate, kept] of legacy.alias.experiment) {
    const id = maps.experiment.get(kept);
    if (id !== undefined) maps.experiment.set(duplicate, id);
  }

  for (const experiment of legacy.experiments) {
    if (experiment.parentExperimentId === null) continue;
    const id = maps.experiment.get(experiment.id);
    const parentLegacy =
      legacy.alias.experiment.get(experiment.parentExperimentId) ?? experiment.parentExperimentId;
    const parentId = maps.experiment.get(parentLegacy);
    if (id === undefined) continue;
    if (parentId === undefined || parentId === id) {
      issues.add(
        "unknown-parent-experiment",
        "dropped",
        `${experiment.ecode}: parent ${experiment.parentExperimentId}`
      );
      continue;
    }
    const current = experimentByCode.get(experiment.ecode);
    if (current && current.parentExperimentId === null) {
      await tx.experiment.update({ where: { id }, data: { parentExperimentId: parentId } });
      current.parentExperimentId = parentId;
    }
  }

  for (const experiment of legacy.experiments) {
    const id = maps.experiment.get(experiment.id);
    if (id === undefined || !newExperiments.has(id)) continue;
    const team = inferTeamFromComment(experiment.comment, userByLowerName);
    if (team.length === 0) continue;
    await tx.experimentMember.createMany({
      data: team.map((member) => ({ experimentId: id, userId: member.userId, role: member.role })),
      skipDuplicates: true,
    });
    created.experimentMembers += team.length;
  }

  // Code counters: the next generated code must not collide with an imported one.
  const codes = (await tx.experiment.findMany({ select: { ecode: true } })).map((e) => e.ecode);
  const prefixes = new Set(codes.flatMap((code) => /^([A-Z]{2,4})\d+$/.exec(code)?.[1] ?? []));
  for (const prefix of prefixes) {
    const highest = highestCodeNumber(prefix, codes);
    const counter = await tx.experimentCodeCounter.findUnique({ where: { prefix } });
    if (!counter) {
      await tx.experimentCodeCounter.create({ data: { prefix, lastNumber: highest } });
      created.codeCounters += 1;
    } else if (counter.lastNumber < highest) {
      await tx.experimentCodeCounter.update({ where: { prefix }, data: { lastNumber: highest } });
      created.codeCounters += 1;
    }
  }

  const summaries: Array<[string, string, number]> = [
    ["user", "members", created.users],
    ["cultivar", "cultivars", created.cultivars],
    ["location", "locations", created.locations],
    ["organization", "organizations", created.organizations],
    ["experiment", "experiments", created.experiments],
  ];
  for (const [entityType, noun, count] of summaries) {
    if (count === 0) continue;
    const extra =
      entityType === "user"
        ? ` (${legacy.users.filter((u) => u.active).length} pending invitations, never a password)`
        : entityType === "experiment"
          ? ` with ${created.experimentMembers} team memberships`
          : "";
    await auditSummary(
      tx,
      actor,
      entityType,
      `Cannabase import: ${noun}`,
      `Imported ${count} ${noun} from the legacy system${extra}`,
      [countChange(noun, count)]
    );
  }
}

type UnitContext = {
  legacy: LegacyData;
  unitById: Map<number, LegacyUnit>;
  actor: SessionUser;
  importedAt: Date;
  maps: IdMaps;
  created: EntityCounts;
  existing: EntityCounts;
  preexisting: Map<string, number>;
};

function sourceTypeFor(
  unit: LegacyUnit,
  parent: LegacyUnit | undefined,
  received: boolean
): SourceType | null {
  if (received) return SourceType.RECEIVED;
  if (!parent) return null;
  if (parent.type === UnitType.SEEDLOT) return SourceType.SEED;
  if (unit.type === UnitType.CULTURE) return SourceType.SUBCULTURE;
  if (unit.type === UnitType.FLOWER || unit.type === UnitType.SEEDLOT) return SourceType.HARVEST;
  if (unit.type === UnitType.PLANT) {
    return parent.type === UnitType.CULTURE ? SourceType.CLONE : SourceType.CUTTING;
  }
  return SourceType.OTHER;
}

async function importUnit(tx: Tx, unit: LegacyUnit, ctx: UnitContext) {
  const { legacy, unitById, actor, importedAt, maps, created, existing, preexisting } = ctx;
  const plan = legacy.plans.get(unit.id)!;

  // Already imported: keep it exactly as it is, but remember its ids for children and links.
  const known = preexisting.get(unit.name);
  if (known !== undefined) {
    maps.unit.set(unit.id, known);
    const states = await tx.unitState.findMany({
      where: { unitId: known },
      orderBy: { sequence: "asc" },
      select: { id: true },
    });
    const last = states[states.length - 1]?.id;
    if (last !== undefined) maps.lastState.set(unit.id, last);
    for (const [legacyStateId, index] of plan.eventIndexByState) {
      const stateId = states[index]?.id ?? last;
      if (stateId !== undefined) maps.state.set(legacyStateId, stateId);
    }
    existing.units += 1;
    return;
  }

  const lineage = legacy.lineage.get(unit.id);
  const parentUnit = lineage ? unitById.get(lineage.parentUnitId) : undefined;
  const sourceParentUnitId = lineage ? (maps.unit.get(lineage.parentUnitId) ?? null) : null;
  const parentStateId = lineage
    ? (maps.state.get(lineage.parentStateId) ?? maps.lastState.get(lineage.parentUnitId) ?? null)
    : null;

  const descriptionParts: string[] = [];
  if (parentUnit) {
    descriptionParts.push(
      `Derived from ${parentUnit.name}${lineage?.comment ? ` (${lineage.comment})` : ""}`
    );
  }
  if (unit.originName) descriptionParts.push(`Legacy origin: ${unit.originName}`);

  const providerOrganizationId =
    plan.providerOrganizationId === null
      ? null
      : (maps.organization.get(plan.providerOrganizationId) ?? null);
  const row = await tx.biologicalUnit.create({
    data: {
      name: unit.name,
      type: unit.type,
      cultivarId: unit.cultivarId === null ? null : (maps.cultivar.get(unit.cultivarId) ?? null),
      experimentId:
        unit.experimentId === null ? null : (maps.experiment.get(unit.experimentId) ?? null),
      sex: unit.sex,
      comment: unit.comment,
      sourceType: sourceTypeFor(unit, parentUnit, plan.providerOrganizationId !== null),
      sourceDescription:
        descriptionParts.length > 0
          ? `Imported from the legacy system. ${descriptionParts.join("; ")}`
          : null,
      providerOrganizationId,
      sourceParentUnitId,
    },
  });
  maps.unit.set(unit.id, row.id);

  const stateIds: number[] = [];
  for (const [index, event] of plan.events.entries()) {
    const state = await tx.unitState.create({
      data: {
        unitId: row.id,
        sequence: index + 1,
        kind: event.kind,
        effectiveAt: event.effectiveAt,
        recordedAt: importedAt,
        recordedById:
          (event.recordedByLegacyUserId === null
            ? undefined
            : maps.user.get(event.recordedByLegacyUserId)) ?? actor.id,
        locationId:
          event.snapshot.locationId === null
            ? null
            : (maps.location.get(event.snapshot.locationId) ?? null),
        growthStage: event.snapshot.growthStage,
        humidWeight: event.snapshot.humidWeight,
        dryWeight: event.snapshot.dryWeight,
        seedCount: event.snapshot.seedCount,
        organizationId:
          event.organizationId === null
            ? null
            : (maps.organization.get(event.organizationId) ?? null),
        reason: event.reason,
        comment: event.comment,
        parentStateId: index === 0 ? parentStateId : null,
      },
    });
    stateIds.push(state.id);
  }
  const lastStateId = stateIds[stateIds.length - 1]!;
  await tx.biologicalUnit.update({ where: { id: row.id }, data: { currentStateId: lastStateId } });
  maps.lastState.set(unit.id, lastStateId);
  for (const [legacyStateId, index] of plan.eventIndexByState) {
    const stateId = stateIds[index];
    if (stateId !== undefined) maps.state.set(legacyStateId, stateId);
  }

  const lastKind = plan.events[plan.events.length - 1]!.kind;
  if (unit.hold) {
    if (lastKind === UnitStateKind.DESTROYED || lastKind === UnitStateKind.SHIPPED) {
      legacy.issues.add(
        "hold-on-terminal-unit",
        "info",
        `${unit.name}: legacy hold not recreated, the unit has left inventory`
      );
    } else {
      await tx.unitHold.create({
        data: {
          unitId: row.id,
          kind: unit.hold.kind,
          reason: unit.hold.reason?.trim() || DEFAULT_HOLD_REASON,
          origin: HoldOrigin.MANUAL,
          placedById: actor.id,
          placedAt: unit.hold.at ?? importedAt,
        },
      });
      created.holds += 1;
    }
  }

  created.units += 1;
  created.states += stateIds.length;
}

async function linkExperimentSourceUnits(tx: Tx, legacy: LegacyData, maps: IdMaps) {
  for (const experiment of legacy.experiments) {
    if (experiment.sourceUnitId === null) continue;
    const experimentId = maps.experiment.get(experiment.id);
    const unitId = maps.unit.get(experiment.sourceUnitId);
    if (experimentId === undefined) continue;
    if (unitId === undefined) {
      legacy.issues.add(
        "unknown-source-unit",
        "dropped",
        `${experiment.ecode}: source unit ${experiment.sourceUnitId} was not imported`
      );
      continue;
    }
    // Fill only; a link an operator has since set or cleared is theirs.
    await tx.experiment.updateMany({
      where: { id: experimentId, sourceUnitId: null },
      data: { sourceUnitId: unitId },
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

function argValue(flagName: string): string | undefined {
  const index = process.argv.indexOf(flagName);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const actorName = argValue("--actor")?.trim();
  const dryRun = process.argv.includes("--dry-run");
  const sql = loadCannabaseSql(argValue("--dump"));

  if (dryRun) {
    const analysis = analyzeCannabase(sql, { timeZone: env().LAB_TIMEZONE });
    console.log(`Dump sha256 ${analysis.checksum}`);
    console.log(
      `Would import ${analysis.legacy.units.length} units (${analysis.legacy.stats.legacyStates} legacy states -> ` +
        `${JSON.stringify(analysis.legacy.stats.plannedEvents)})`
    );
    console.log(formatIssues(analysis.issues));
    return;
  }

  if (!actorName) throw new Error("--actor <username> is required (an active administrator).");
  const actor = await prisma.user.findFirst({
    where: { name: { equals: actorName, mode: "insensitive" } },
  });
  if (!actor) throw new Error(`No member named "${actorName}".`);

  const result = await importCannabase({
    sql,
    actor: { id: actor.id, name: actor.name, permissions: actor.permissions },
    allowProduction: process.argv.includes("--allow-production"),
    log: (message) => console.log(message),
  });

  console.log("\nCreated:", result.created);
  console.log("Already present (left untouched):", result.existing);
  console.log("\nLegacy values needing attention");
  console.log(formatIssues(result.issues));
  console.log("\nNext: npm run migrate:validate -- --dump <file.sql>");
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase();

if (invokedDirectly) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
