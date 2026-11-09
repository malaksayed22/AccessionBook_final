import { prisma } from "@/server/db";
import { formatLabDate, formatLabDateTime, labZone, toDateKey } from "./date-range";
import { startOfNextZonedDay } from "@/lib/lab-time";
import { getActiveStatesAtDate, type SnapshotState } from "./state-at-date";
import type { ReportFilters, ReportResult, ReportSection } from "./types";

type Group = { count: number; humid: number; dry: number; seeds: number };

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function groupBy(states: SnapshotState[], keyOf: (s: SnapshotState) => string) {
  const groups = new Map<string, Group>();
  for (const s of states) {
    const key = keyOf(s);
    const group = groups.get(key) ?? { count: 0, humid: 0, dry: 0, seeds: 0 };
    group.count += 1;
    group.humid += s.humidWeight ?? 0;
    group.dry += s.dryWeight ?? 0;
    group.seeds += s.seedCount ?? 0;
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function summarySection(
  id: string,
  title: string,
  keyColumn: { key: string; label: string },
  groups: Array<[string, Group]>
): ReportSection {
  return {
    id,
    title,
    columns: [
      keyColumn,
      { key: "count", label: "Count", align: "right" },
      { key: "wet", label: "Wet weight (g)", align: "right" },
      { key: "dry", label: "Dry weight (g)", align: "right" },
      { key: "seeds", label: "Seeds", align: "right" },
    ],
    rows: groups.map(([key, g]) => ({
      [keyColumn.key]: key,
      count: g.count,
      wet: round3(g.humid),
      dry: round3(g.dry),
      seeds: g.seeds,
    })),
  };
}

function quantityOf(s: SnapshotState): string {
  if (s.seedCount != null) return `${s.seedCount} seeds`;
  if (s.dryWeight != null) return `${s.dryWeight} g dry`;
  if (s.humidWeight != null) return `${s.humidWeight} g wet`;
  return "—";
}

type ReportIdentity = { reportId: string; title: string; subtitle: string };

const SNAPSHOT_IDENTITY: ReportIdentity = {
  reportId: "inventory-snapshot",
  title: "Inventory Snapshot",
  subtitle: "Active biological inventory",
};

/** Active units as of `asOf` (default: now), optionally narrowed by type, location, experiment. */
export async function generateInventorySnapshot(
  filters: ReportFilters,
  asOf: Date = new Date(),
  identity: ReportIdentity = SNAPSHOT_IDENTITY
): Promise<ReportResult> {
  const zone = labZone();
  const states = await getActiveStatesAtDate(asOf, {
    unitType: filters.unitType,
    locationId: filters.locationId,
    experimentId: filters.experimentId,
  });

  const byLocation = groupBy(states, (s) => s.locationName ?? "Unassigned");
  const byCultivar = groupBy(states, (s) => s.cultivarName ?? "Unknown");

  return {
    meta: {
      reportId: identity.reportId,
      title: identity.title,
      generatedAt: new Date().toISOString(),
      periodLabel: `As of ${formatLabDateTime(asOf, zone)}`,
      subtitle: identity.subtitle,
    },
    kpis: [
      { id: "activeUnits", label: "Active units", value: states.length },
      { id: "locations", label: "Locations", value: byLocation.length },
      { id: "cultivars", label: "Cultivars", value: byCultivar.length },
      {
        id: "experiments",
        label: "Experiments",
        value: new Set(states.map((s) => s.experimentId).filter((id) => id != null)).size,
      },
    ],
    sections: [
      summarySection(
        "by-type",
        "Summary by material type",
        { key: "type", label: "Type" },
        groupBy(states, (s) => s.unitType)
      ),
      summarySection(
        "by-stage",
        "Summary by growth stage",
        { key: "stage", label: "Stage" },
        groupBy(states, (s) => s.growthStage ?? "No stage")
      ),
      summarySection(
        "by-location",
        "Summary by location",
        { key: "location", label: "Location" },
        byLocation
      ),
      summarySection(
        "by-cultivar",
        "Summary by cultivar",
        { key: "cultivar", label: "Cultivar" },
        byCultivar
      ),
      {
        id: "unit-detail",
        title: "Unit detail",
        columns: [
          { key: "name", label: "Unit" },
          { key: "type", label: "Type" },
          { key: "cultivar", label: "Cultivar" },
          { key: "experiment", label: "Experiment" },
          { key: "location", label: "Location" },
          { key: "stage", label: "Stage / state" },
          { key: "quantity", label: "Qty / weight" },
        ],
        rows: states.map((s) => ({
          name: s.unitName,
          type: s.unitType,
          cultivar: s.cultivarName ?? "—",
          experiment: s.experimentCode ?? "—",
          location: s.locationName ?? "—",
          stage: s.growthStage ?? "—",
          quantity: quantityOf(s),
          _href: `/inventory/units/${s.unitId}`,
        })),
      },
    ],
  };
}

/**
 * What the inventory looked like at the end of a laboratory day (or right now, for today). It is
 * the same reconstruction as the snapshot, driven by each event's effective date, so it answers
 * "what did we hold on the 14th?" for an inspector. A day in the future reads as now.
 */
export async function generateStateAtDate(
  filters: ReportFilters,
  now: Date = new Date()
): Promise<ReportResult> {
  const zone = labZone();
  const dayKey = toDateKey(filters.asOf ?? formatLabDate(now, zone), zone);
  const endOfDay = new Date(startOfNextZonedDay(dayKey, zone).getTime() - 1);
  const asOf = endOfDay.getTime() > now.getTime() ? now : endOfDay;
  const result = await generateInventorySnapshot(filters, asOf, {
    reportId: "state-at-date",
    title: "Inventory State at Date",
    subtitle: "Active biological inventory reconstructed from effective dates",
  });
  return { ...result, meta: { ...result.meta, periodLabel: `As of ${dayKey}` } };
}

export async function getReportFilterOptions() {
  const [locations, experiments] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.experiment.findMany({
      orderBy: { ecode: "asc" },
      select: { id: true, ecode: true, name: true, endDate: true },
    }),
  ]);
  return { locations, experiments };
}
