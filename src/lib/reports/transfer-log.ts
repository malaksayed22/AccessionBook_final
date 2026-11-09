import { UnitStateKind } from "@/generated/prisma/enums";
import { formatLabDateTime, labZone, parseDateRange } from "./date-range";
import { getInventoryEvents } from "./events";
import type { ReportFilters, ReportResult } from "./types";

export async function generateTransferLog(filters: ReportFilters): Promise<ReportResult> {
  const zone = labZone();
  const { start, endExclusive, label } = parseDateRange(filters.from, filters.to, zone);

  const transfers = await getInventoryEvents({
    kinds: [UnitStateKind.MOVED],
    from: start,
    to: endExclusive,
    locationId: filters.locationId,
  });

  return {
    meta: {
      reportId: "transfer-log",
      title: "Chain of Custody — Location Transfers",
      generatedAt: new Date().toISOString(),
      periodLabel: label,
      subtitle: "Physical custody audit trail with barcode confirmation",
    },
    kpis: [
      { id: "totalTransfers", label: "Total transfers", value: transfers.length },
      {
        id: "barcodeConfirmed",
        label: "Barcode confirmed",
        value: transfers.filter((t) => t.scanConfirmed).length,
      },
      {
        id: "unconfirmedScans",
        label: "Unconfirmed scans",
        value: transfers.filter((t) => !t.scanConfirmed).length,
      },
    ],
    sections: [
      {
        id: "transfer-records",
        title: "Transfer records",
        columns: [
          { key: "date", label: "Date / time" },
          { key: "unit", label: "Unit" },
          { key: "type", label: "Type" },
          { key: "cultivar", label: "Cultivar" },
          { key: "experiment", label: "Experiment" },
          { key: "from", label: "From location" },
          { key: "to", label: "To location" },
          { key: "confirmed", label: "Barcode confirmed" },
          { key: "operator", label: "Operator" },
          { key: "comment", label: "Notes" },
        ],
        rows: transfers.map((t) => ({
          date: formatLabDateTime(t.effectiveAt, zone),
          unit: t.unitName,
          type: t.unitType,
          cultivar: t.cultivarName ?? "—",
          experiment: t.experimentCode ?? "—",
          from: t.previousLocationName ?? "—",
          to: t.locationName ?? "—",
          confirmed: t.scanConfirmed ? "Yes" : "No",
          operator: t.recordedByName,
          comment: t.comment ?? "",
        })),
      },
    ],
  };
}
