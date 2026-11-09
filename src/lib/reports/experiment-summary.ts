import { getExperimentStatus } from "@/lib/lab";
import { prisma } from "@/server/db";
import { formatLabDate, labZone } from "./date-range";
import type { ReportFilters, ReportResult } from "./types";

type UnitCountRow = { experimentId: number; unitType: string; outcome: string; units: number };

/** Units per experiment, material type and fate (active / destroyed; shipping is not a fate), in one query. */
async function countUnits(): Promise<UnitCountRow[]> {
  return prisma.$queryRaw<UnitCountRow[]>`
    SELECT u."experimentId" AS "experimentId",
           u."type"::text AS "unitType",
           CASE s."kind"::text
             WHEN 'DESTROYED' THEN 'destroyed'
             ELSE 'active'
           END AS "outcome",
           count(*)::int AS "units"
    FROM "BiologicalUnit" u
    LEFT JOIN "UnitState" s ON s."id" = u."currentStateId"
    WHERE u."experimentId" IS NOT NULL
    GROUP BY 1, 2, 3`;
}

export async function generateExperimentSummary(filters: ReportFilters): Promise<ReportResult> {
  const zone = labZone();
  const [allExperiments, counts] = await Promise.all([
    prisma.experiment.findMany({
      include: {
        members: { include: { user: true } },
        _count: { select: { subExperiments: true } },
      },
      orderBy: { ecode: "asc" },
    }),
    countUnits(),
  ]);

  let experiments = allExperiments;
  if (filters.experimentId) {
    experiments = experiments.filter((e) => e.id === filters.experimentId);
  }
  if (filters.status && filters.status !== "all") {
    experiments = experiments.filter((e) => getExperimentStatus(e.endDate) === filters.status);
  }

  const rows = experiments.map((exp) => {
    const mine = counts.filter((c) => c.experimentId === exp.id);
    const sum = (predicate: (c: UnitCountRow) => boolean) =>
      mine.filter(predicate).reduce((total, c) => total + c.units, 0);
    const activeOfType = (type: string) =>
      sum((c) => c.outcome === "active" && c.unitType === type);

    return {
      ecode: exp.ecode,
      name: exp.name,
      status: getExperimentStatus(exp.endDate),
      start: formatLabDate(exp.startDate, zone),
      end: exp.endDate ? formatLabDate(exp.endDate, zone) : "Ongoing",
      totalUnits: sum(() => true),
      active: sum((c) => c.outcome === "active"),
      destroyed: sum((c) => c.outcome === "destroyed"),
      plants: activeOfType("PLANT"),
      cultures: activeOfType("CULTURE"),
      seedLots: activeOfType("SEEDLOT"),
      flowers: activeOfType("FLOWER"),
      team:
        exp.members.map((m) => `${m.user.name}${m.role === "LEAD" ? " (lead)" : ""}`).join(", ") ||
        "—",
      subExperiments: exp._count.subExperiments,
    };
  });

  return {
    meta: {
      reportId: "experiment-summary",
      title: "Experiment Summary",
      generatedAt: new Date().toISOString(),
      periodLabel: filters.status ? `Status: ${filters.status}` : "All experiments",
    },
    kpis: [
      { id: "experiments", label: "Experiments", value: experiments.length },
      { id: "totalUnits", label: "Total units", value: rows.reduce((s, r) => s + r.totalUnits, 0) },
      {
        id: "activeExperiments",
        label: "Active experiments",
        value: experiments.filter((e) => getExperimentStatus(e.endDate) === "active").length,
      },
    ],
    sections: [
      {
        id: "experiment-overview",
        title: "Experiment overview",
        columns: [
          { key: "ecode", label: "Code" },
          { key: "name", label: "Name" },
          { key: "status", label: "Status" },
          { key: "start", label: "Start" },
          { key: "end", label: "End" },
          { key: "totalUnits", label: "Units", align: "right" },
          { key: "active", label: "Active", align: "right" },
          { key: "destroyed", label: "Destroyed", align: "right" },
          { key: "plants", label: "Plants", align: "right" },
          { key: "cultures", label: "Cultures", align: "right" },
          { key: "seedLots", label: "Seed lots", align: "right" },
          { key: "flowers", label: "Flowers", align: "right" },
          { key: "team", label: "Team" },
          { key: "subExperiments", label: "Sub-exp.", align: "right" },
        ],
        rows,
      },
    ],
  };
}
