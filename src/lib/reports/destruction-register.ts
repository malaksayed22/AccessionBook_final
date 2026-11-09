import { UnitStateKind } from "@/generated/prisma/enums";
import { formatLabDateTime, labZone, parseDateRange } from "./date-range";
import { getInventoryEvents } from "./events";
import type { ReportFilters, ReportResult } from "./types";

export async function generateDestructionRegister(filters: ReportFilters): Promise<ReportResult> {
  const zone = labZone();
  const { start, endExclusive, label } = parseDateRange(filters.from, filters.to, zone);

  const destructions = await getInventoryEvents({
    kinds: [UnitStateKind.DESTROYED],
    from: start,
    to: endExclusive,
  });

  return {
    meta: {
      reportId: "destruction-register",
      title: "Destruction Register",
      generatedAt: new Date().toISOString(),
      periodLabel: label,
      subtitle: "Health Canada inspection-ready destruction record",
    },
    kpis: [
      { id: "totalDestructions", label: "Total destructions", value: destructions.length },
      {
        id: "plantsDestroyed",
        label: "Plants destroyed",
        value: destructions.filter((d) => d.unitType === "PLANT").length,
      },
      {
        id: "culturesDestroyed",
        label: "Cultures destroyed",
        value: destructions.filter((d) => d.unitType === "CULTURE").length,
      },
    ],
    sections: [
      {
        id: "destruction-records",
        title: "Destruction records",
        description:
          "Destruction date is when the material was destroyed; filed at is when the record was entered.",
        columns: [
          { key: "date", label: "Destruction date" },
          { key: "unit", label: "Unit ID / name" },
          { key: "type", label: "Material type" },
          { key: "cultivar", label: "Cultivar" },
          { key: "experiment", label: "Experiment" },
          { key: "location", label: "Last location" },
          { key: "stage", label: "Last stage" },
          { key: "weight", label: "Weight (g)" },
          { key: "reason", label: "Reason for destruction" },
          { key: "recordedBy", label: "Recorded by" },
          { key: "filedAt", label: "Filed at" },
        ],
        rows: destructions.map((d) => {
          const weight = d.dryWeight ?? d.humidWeight;
          return {
            date: formatLabDateTime(d.effectiveAt, zone),
            unit: d.unitName,
            type: d.unitType,
            cultivar: d.cultivarName ?? "—",
            experiment: d.experimentCode ?? "—",
            location: d.locationName ?? "—",
            stage: d.growthStage ?? "—",
            weight: weight != null ? weight.toFixed(2) : "—",
            reason: d.reason ?? "",
            recordedBy: d.recordedByName,
            filedAt: formatLabDateTime(d.recordedAt, zone),
            _href: `/inventory/units/${d.unitId}`,
          };
        }),
      },
    ],
  };
}
