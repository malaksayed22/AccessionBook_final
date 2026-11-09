import { UnitStateKind } from "@/generated/prisma/enums";
import { formatLabDateTime, labZone, parseDateRange } from "./date-range";
import { getInventoryEvents, type InventoryEvent } from "./events";
import type { ReportFilters, ReportResult } from "./types";

type Direction = "Addition" | "Reduction" | "Change";

const ALL_KINDS = Object.values(UnitStateKind);

function classify(event: InventoryEvent): { direction: Direction; action: string; detail: string } {
  switch (event.kind) {
    case UnitStateKind.CREATED:
      return event.parentUnitName
        ? {
            direction: "Addition",
            action: "Derived",
            detail: `From parent ${event.parentUnitName}`,
          }
        : {
            direction: "Addition",
            action: "Registered",
            detail: event.sourceType ? `Source: ${event.sourceType}` : "",
          };
    case UnitStateKind.RECEIVED:
      return {
        direction: "Addition",
        action: "Received",
        detail: event.organizationName ? `From ${event.organizationName}` : "",
      };
    case UnitStateKind.SHIPPED_PART:
    case UnitStateKind.SHIPPED: {
      const amount =
        event.shippedWeight != null
          ? `${event.shippedWeight} g ${event.shippedMoisture === "DRY" ? "dry" : "wet"}`
          : event.shippedCount != null
            ? `${event.shippedCount} seeds`
            : null;
      return {
        direction: "Reduction",
        action: event.kind === UnitStateKind.SHIPPED_PART ? "Shipped (part)" : "Shipped",
        detail: [event.organizationName ? `To ${event.organizationName}` : null, amount]
          .filter(Boolean)
          .join(" — "),
      };
    }
    case UnitStateKind.SAMPLED:
      return {
        direction: "Change",
        action: "Sampled",
        detail:
          event.shippedWeight != null
            ? `${event.shippedWeight} g ${event.shippedMoisture === "DRY" ? "dry" : "wet"} taken as a sample`
            : event.shippedCount != null
              ? `${event.shippedCount} seeds taken as a sample`
              : "Sample taken",
      };
    case UnitStateKind.WASTED:
      return {
        direction: "Reduction",
        action: "Waste disposed",
        detail: [
          event.shippedWeight != null
            ? `${event.shippedWeight} g ${event.shippedMoisture === "DRY" ? "dry" : "wet"}`
            : null,
          event.reason,
        ]
          .filter(Boolean)
          .join(" — "),
      };
    case UnitStateKind.REGROUPED:
      return {
        direction: "Change",
        action: "Regrouped",
        detail: `${event.plantCount ?? 1} plants in the group`,
      };
    case UnitStateKind.MERGED:
      return {
        direction: "Change",
        action: "Merged",
        detail: event.comment ?? "Joined another plant group",
      };
    case UnitStateKind.DESTROYED:
      return {
        direction: "Reduction",
        action: "Destroyed",
        detail: [event.reason, event.witnessName ? `witness: ${event.witnessName}` : null]
          .filter(Boolean)
          .join(" — "),
      };
    case UnitStateKind.MOVED:
      return {
        direction: "Change",
        action: "Moved",
        detail: `${event.previousLocationName ?? "—"} → ${event.locationName ?? "—"}`,
      };
    case UnitStateKind.STAGE_CHANGED:
      return {
        direction: "Change",
        action: "Stage transition",
        detail: `${event.previousStage ?? "—"} → ${event.growthStage ?? "—"}`,
      };
    case UnitStateKind.MEASURED:
      return {
        direction: "Change",
        action: "Measured",
        detail: [
          event.humidWeight != null ? `wet ${event.humidWeight} g` : null,
          event.dryWeight != null ? `dry ${event.dryWeight} g` : null,
          event.seedCount != null ? `${event.seedCount} seeds` : null,
        ]
          .filter(Boolean)
          .join(", "),
      };
  }
}

export async function generateInventoryMovement(filters: ReportFilters): Promise<ReportResult> {
  const zone = labZone();
  const { start, endExclusive, label } = parseDateRange(filters.from, filters.to, zone);

  const events = await getInventoryEvents({ kinds: ALL_KINDS, from: start, to: endExclusive });

  const ledger = events.map((event) => {
    const { direction, action, detail } = classify(event);
    return {
      date: formatLabDateTime(event.effectiveAt, zone),
      direction,
      action,
      unit: event.unitName,
      type: event.unitType,
      cultivar: event.cultivarName ?? "—",
      detail,
      user: event.recordedByName,
      _href: `/inventory/units/${event.unitId}`,
    };
  });

  const byAction = new Map<string, { direction: Direction; count: number }>();
  for (const row of ledger) {
    const entry = byAction.get(row.action) ?? { direction: row.direction, count: 0 };
    entry.count += 1;
    byAction.set(row.action, entry);
  }

  const countDirection = (direction: Direction) =>
    ledger.filter((r) => r.direction === direction).length;

  return {
    meta: {
      reportId: "inventory-movement",
      title: "Inventory Movement Ledger",
      generatedAt: new Date().toISOString(),
      periodLabel: label,
    },
    kpis: [
      { id: "totalEvents", label: "Total events", value: ledger.length },
      { id: "additions", label: "Additions", value: countDirection("Addition") },
      { id: "reductions", label: "Reductions", value: countDirection("Reduction") },
      {
        id: "stageChanges",
        label: "Stage changes",
        value: byAction.get("Stage transition")?.count ?? 0,
      },
    ],
    sections: [
      {
        id: "movement-ledger",
        title: "Movement ledger",
        columns: [
          { key: "date", label: "Date" },
          { key: "direction", label: "Direction" },
          { key: "action", label: "Action" },
          { key: "unit", label: "Unit" },
          { key: "type", label: "Type" },
          { key: "cultivar", label: "Cultivar" },
          { key: "detail", label: "Detail" },
          { key: "user", label: "User" },
        ],
        rows: ledger,
      },
      {
        id: "event-summary",
        title: "Summary by event",
        columns: [
          { key: "direction", label: "Direction" },
          { key: "action", label: "Action" },
          { key: "count", label: "Events", align: "right" },
        ],
        rows: [...byAction.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([action, { direction, count }]) => ({ direction, action, count })),
      },
    ],
  };
}
