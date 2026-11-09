import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { highestCodeNumber } from "../src/lib/experiment-codes";
import { prisma } from "../src/server/db";
import { env } from "../src/server/env";
import { analyzeCannabase } from "./import-cannabase";
import { loadCannabaseSql } from "./sql-parser";

/**
 * Post-migration integrity checks for the rebuilt data model (see MIGRATION.md).
 *
 *   npm run migrate:validate                          # database checks only
 *   npm run migrate:validate -- --dump legacy.sql     # also reconcile against the legacy dump
 *
 * Exits non-zero if any fatal check fails so it can gate a cutover.
 */
export type Check = {
  name: string;
  detail: string;
  failures: string[];
  /** A failing non-fatal check is a punch-list item, not a blocker. */
  fatal: boolean;
};

export type ValidationResult = {
  counts: Record<string, number>;
  checks: Check[];
  /** True when at least one fatal check has failures. */
  failed: boolean;
  skipped: string[];
};

export type ValidationOptions = {
  /** The legacy dump; enables the non-importable-values and reconciliation checks. */
  sql?: string;
  timeZone?: string;
};

type NamedRow = { id: number; name: string };

const label = (row: NamedRow) => `${row.name} (id ${row.id})`;

export async function runChecks(options: ValidationOptions = {}): Promise<ValidationResult> {
  const checks: Check[] = [];
  const skipped: string[] = [];
  const check = (name: string, detail: string, failures: string[], fatal = true) =>
    checks.push({ name, detail, failures, fatal });

  const [
    users,
    cultivars,
    experiments,
    experimentMembers,
    locations,
    organizations,
    units,
    states,
    holds,
    auditEntries,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.cultivar.count(),
    prisma.experiment.count(),
    prisma.experimentMember.count(),
    prisma.location.count(),
    prisma.organization.count(),
    prisma.biologicalUnit.count(),
    prisma.unitState.count(),
    prisma.unitHold.count(),
    prisma.auditLog.count(),
  ]);
  const counts = {
    users,
    cultivars,
    experiments,
    experimentMembers,
    locations,
    organizations,
    units,
    states,
    holds,
    auditEntries,
  };

  // --- unit state chains ----------------------------------------------------------------------
  check(
    "Every unit has a current state",
    "A unit without one is invisible in inventory.",
    (
      await prisma.biologicalUnit.findMany({
        where: { currentStateId: null },
        select: { id: true, name: true },
      })
    ).map(label)
  );

  check(
    "currentStateId names the unit's newest state",
    "The pointer must be its own unit's highest sequence.",
    (
      await prisma.$queryRaw<NamedRow[]>`
        SELECT u."id", u."name" FROM "BiologicalUnit" u
        JOIN "UnitState" s ON s."id" = u."currentStateId"
        WHERE s."unitId" <> u."id"
           OR s."sequence" <> (SELECT max(x."sequence") FROM "UnitState" x WHERE x."unitId" = u."id")`
    ).map(label)
  );

  check(
    "State sequences are contiguous from 1",
    "A gap means an event is missing from the history.",
    (
      await prisma.$queryRaw<NamedRow[]>`
        SELECT u."id", u."name" FROM "UnitState" s
        JOIN "BiologicalUnit" u ON u."id" = s."unitId"
        GROUP BY u."id", u."name"
        HAVING min(s."sequence") <> 1 OR max(s."sequence") <> count(*)`
    ).map(label)
  );

  check(
    "Every unit's first event is CREATED or RECEIVED",
    "Anything else means the unit's origin is unrecorded.",
    (
      await prisma.$queryRaw<Array<NamedRow & { kind: string }>>`
        SELECT u."id", u."name", s."kind"::text AS "kind" FROM "UnitState" s
        JOIN "BiologicalUnit" u ON u."id" = s."unitId"
        WHERE s."sequence" = 1 AND s."kind" NOT IN ('CREATED', 'RECEIVED')`
    ).map((row) => `${label(row)} starts with ${row.kind}`)
  );

  check(
    "Nothing follows a SHIPPED or DESTROYED event",
    "These are terminal: the unit has left inventory.",
    (
      await prisma.$queryRaw<NamedRow[]>`
        SELECT DISTINCT u."id", u."name" FROM "UnitState" s
        JOIN "BiologicalUnit" u ON u."id" = s."unitId"
        WHERE s."kind" IN ('SHIPPED', 'DESTROYED')
          AND EXISTS (SELECT 1 FROM "UnitState" n WHERE n."unitId" = s."unitId" AND n."sequence" > s."sequence")`
    ).map(label)
  );

  check(
    "Destroyed events carry a reason",
    "Destruction is a regulated act; the reason is mandatory.",
    (
      await prisma.$queryRaw<NamedRow[]>`
        SELECT u."id", u."name" FROM "UnitState" s
        JOIN "BiologicalUnit" u ON u."id" = s."unitId"
        WHERE s."kind" = 'DESTROYED' AND btrim(coalesce(s."reason", '')) = ''`
    ).map(label)
  );

  check(
    "Active units have a storage location",
    "Required for inventory reconciliation; the lab backfills these by hand.",
    (
      await prisma.$queryRaw<NamedRow[]>`
        SELECT u."id", u."name" FROM "BiologicalUnit" u
        JOIN "UnitState" s ON s."id" = u."currentStateId"
        WHERE s."kind" NOT IN ('SHIPPED', 'DESTROYED') AND s."locationId" IS NULL`
    ).map(label),
    false
  );

  // --- lineage --------------------------------------------------------------------------------
  const lineage = await prisma.biologicalUnit.findMany({
    select: { id: true, name: true, sourceParentUnitId: true },
  });
  const parentById = new Map(lineage.map((u) => [u.id, u.sourceParentUnitId]));
  const cycles: string[] = [];
  for (const unit of lineage) {
    const seen = new Set<number>([unit.id]);
    let cursor = unit.sourceParentUnitId;
    while (cursor != null) {
      if (seen.has(cursor)) {
        cycles.push(label(unit));
        break;
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }
  check("Lineage has no cycles", "A cycle would hang mother-plant resolution.", cycles);

  check(
    "A derived unit's first state points at a state of its parent",
    "parentStateId and sourceParentUnitId must agree.",
    (
      await prisma.$queryRaw<NamedRow[]>`
        SELECT u."id", u."name" FROM "BiologicalUnit" u
        JOIN "UnitState" f ON f."unitId" = u."id" AND f."sequence" = 1
        JOIN "UnitState" p ON p."id" = f."parentStateId"
        WHERE p."unitId" IS DISTINCT FROM u."sourceParentUnitId"`
    ).map(label)
  );

  // --- names ----------------------------------------------------------------------------------
  const duplicates = async (table: string): Promise<string[]> => {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; n: bigint }>>(
      `SELECT lower("name") AS name, count(*) AS n FROM "${table}" GROUP BY lower("name") HAVING count(*) > 1`
    );
    return rows.map((row) => `${table}: "${row.name}" x${row.n}`);
  };
  check(
    "Unit names are unique (case-insensitive)",
    "Names are printed on labels and scanned; near-duplicates are unsafe.",
    await duplicates("BiologicalUnit")
  );
  check(
    "Cultivar, location, organization and member names are unique (case-insensitive)",
    "Near-duplicates split one record into two.",
    (await Promise.all(["Cultivar", "Location", "Organization", "User"].map(duplicates))).flat(),
    false
  );

  // --- experiment codes -----------------------------------------------------------------------
  const codes = (await prisma.experiment.findMany({ select: { ecode: true } })).map((e) => e.ecode);
  const counters = new Map(
    (await prisma.experimentCodeCounter.findMany()).map((c) => [c.prefix, c.lastNumber])
  );
  const counterFailures: string[] = [];
  for (const prefix of new Set(
    codes.flatMap((code) => /^([A-Z]{2,4})\d+$/.exec(code)?.[1] ?? [])
  )) {
    const highest = highestCodeNumber(prefix, codes);
    const last = counters.get(prefix) ?? 0;
    if (last < highest) {
      counterFailures.push(`${prefix}: counter at ${last}, but ${prefix}${highest} exists`);
    }
  }
  check(
    "Experiment code counters are ahead of every existing code",
    "Otherwise the next new experiment would collide with an imported one.",
    counterFailures
  );

  // --- audit trail ----------------------------------------------------------------------------
  check(
    "Audit chain is intact",
    "audit_verify_chain() returns no rows when every entry links to its predecessor.",
    (
      await prisma.$queryRaw<Array<{ broken_seq: number; reason: string }>>`
        SELECT * FROM audit_verify_chain()`
    ).map((row) => `entry ${row.broken_seq}: ${row.reason}`)
  );

  // --- legacy dump ----------------------------------------------------------------------------
  if (options.sql === undefined) {
    skipped.push(
      "Legacy dump checks (pass --dump <file.sql>): non-importable values and reconciliation."
    );
  } else {
    const { legacy, issues } = analyzeCannabase(options.sql, {
      timeZone: options.timeZone ?? env().LAB_TIMEZONE,
    });

    check(
      "No legacy values were dropped as non-importable",
      "Unknown types, stages, references and states after a terminal event. Fix the dump or sign off each one.",
      issues
        .filter((issue) => issue.severity === "dropped")
        .flatMap((issue) => issue.examples.map((example) => `${issue.kind}: ${example}`))
    );

    const missing = async (
      noun: string,
      wanted: string[],
      load: () => Promise<string[]>,
      fold: (name: string) => string
    ) => {
      const present = new Set((await load()).map(fold));
      return wanted.filter((name) => !present.has(fold(name))).map((name) => `${noun} ${name}`);
    };
    const lower = (name: string) => name.toLowerCase();
    const exact = (name: string) => name;
    const names = <T extends { name: string }>(rows: T[]) => rows.map((row) => row.name);
    const reconciliation = (
      await Promise.all([
        missing(
          "member",
          legacy.users.map((u) => u.name),
          async () => names(await prisma.user.findMany({ select: { name: true } })),
          lower
        ),
        missing(
          "cultivar",
          legacy.cultivars.map((c) => c.name),
          async () => names(await prisma.cultivar.findMany({ select: { name: true } })),
          lower
        ),
        missing(
          "location",
          legacy.locations.map((l) => l.name),
          async () => names(await prisma.location.findMany({ select: { name: true } })),
          lower
        ),
        missing(
          "organization",
          legacy.organizations.map((o) => o.name),
          async () => names(await prisma.organization.findMany({ select: { name: true } })),
          lower
        ),
        missing(
          "experiment",
          legacy.experiments.map((e) => e.ecode),
          async () =>
            (await prisma.experiment.findMany({ select: { ecode: true } })).map((e) => e.ecode),
          exact
        ),
        missing(
          "unit",
          legacy.units.map((u) => u.name),
          async () => names(await prisma.biologicalUnit.findMany({ select: { name: true } })),
          exact
        ),
      ])
    ).flat();
    check(
      "Every importable legacy record exists in the database",
      "Compares natural keys: member, cultivar, location, organization, experiment code, unit name.",
      reconciliation
    );
  }

  return {
    counts,
    checks,
    failed: checks.some((c) => c.fatal && c.failures.length > 0),
    skipped,
  };
}

export function formatValidation(result: ValidationResult): string {
  const lines: string[] = ["Row counts"];
  for (const [name, count] of Object.entries(result.counts)) {
    lines.push(`  ${name.padEnd(18)} ${count}`);
  }
  lines.push("", "Checks");
  for (const check of result.checks) {
    const status =
      check.failures.length === 0
        ? "PASS"
        : check.fatal
          ? `FAIL (${check.failures.length})`
          : `WARN (${check.failures.length})`;
    lines.push("", `[${status}] ${check.name}`, `        ${check.detail}`);
    for (const failure of check.failures.slice(0, 20)) lines.push(`        - ${failure}`);
    if (check.failures.length > 20) lines.push(`        ...and ${check.failures.length - 20} more`);
  }
  for (const note of result.skipped) lines.push("", `[SKIP] ${note}`);
  lines.push(
    "",
    result.failed
      ? "Migration validation FAILED - do not proceed to cutover."
      : "Migration validation passed."
  );
  return lines.join("\n");
}

async function main() {
  const index = process.argv.indexOf("--dump");
  const dumpPath = index >= 0 ? process.argv[index + 1] : process.env.CANNABASE_SQL_PATH;
  const result = await runChecks({ sql: dumpPath ? loadCannabaseSql(dumpPath) : undefined });
  console.log(formatValidation(result));
  if (result.failed) process.exitCode = 1;
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
