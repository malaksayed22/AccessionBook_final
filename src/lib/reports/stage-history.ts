import { UnitStateKind } from "@/generated/prisma/enums";
import { formatLabDateTime, labZone, parseDateRange } from "./date-range";
import { getInventoryEvents } from "./events";
import type { ReportFilters, ReportResult } from "./types";

export async function generateStageHistory(filters: ReportFilters): Promise<ReportResult> {
  const zone = labZone();
  const { start, endExclusive, label } = parseDateRange(filters.from, filters.to, zone);

  const transitions = await getInventoryEvents({
    kinds: [UnitStateKind.STAGE_CHANGED],
    from: start,
    to: endExclusive,
    unitType: filters.unitType,
  });

  return {
    meta: {
      reportId: "stage-history",
      title: "Stage Transition History",
      generatedAt: new Date().toISOString(),
      periodLabel: label,
    },
    kpis: [
      { id: "transitions", label: "Transitions", value: transitions.length },
      {
        id: "unitsAffected",
        label: "Units affected",
        value: new Set(transitions.map((t) => t.unitId)).size,
      },
      {
        id: "toFlowering",
        label: "To flowering",
        value: transitions.filter((t) => t.growthStage === "FLOWERING").length,
      },
    ],
    sections: [
      {
        id: "stage-transitions",
        title: "Stage transitions",
        columns: [
          { key: "date", label: "Date / time" },
          { key: "unit", label: "Unit" },
          { key: "type", label: "Type" },
          { key: "cultivar", label: "Cultivar" },
          { key: "experiment", label: "Experiment" },
          { key: "from", label: "From stage" },
          { key: "to", label: "To stage" },
          { key: "operator", label: "Operator" },
          { key: "comment", label: "Comment" },
        ],
        rows: transitions.map((t) => ({
          date: formatLabDateTime(t.effectiveAt, zone),
          unit: t.unitName,
          type: t.unitType,
          cultivar: t.cultivarName ?? "—",
          experiment: t.experimentCode ?? "—",
          from: t.previousStage ?? "—",
          to: t.growthStage ?? "—",
          operator: t.recordedByName,
          comment: t.comment ?? "",
        })),
      },
    ],
  };
}
