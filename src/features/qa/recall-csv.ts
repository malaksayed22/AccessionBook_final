import type { RecallNode, RecallShipment, RecallTrace } from "./recall";
import { escapeCsvCell } from "@/lib/reports/csv";
import type { UnitStanding } from "@/lib/unit-standing";

/** Words for the export, already translated by the caller (the lib holds no display text). */
export type RecallCsvLabels = {
  columns: {
    relation: string;
    generation: string;
    unit: string;
    type: string;
    cultivar: string;
    experiment: string;
    status: string;
    hold: string;
    holdReason: string;
    location: string;
    shippedTo: string;
    shipments: string;
  };
  relation: Record<RecallNode["relation"], string>;
  standing: Record<UnitStanding, string>;
  type: Record<RecallNode["type"], string>;
  holdKind: Record<"HOLD", string>;
};

function row(node: RecallNode, shipments: Map<number, RecallShipment>, labels: RecallCsvLabels) {
  return [
    labels.relation[node.relation],
    node.generation,
    node.name,
    labels.type[node.type],
    node.cultivar,
    node.experiment?.ecode,
    labels.standing[node.standing],
    node.hold ? labels.holdKind[node.hold.kind] : "",
    node.hold?.reason,
    node.locationName,
    node.shippedTo.map((org) => org.name).join("; "),
    node.shipmentIds
      .map((id) => shipments.get(id)?.reference)
      .filter(Boolean)
      .join("; "),
  ];
}

/** The whole trace as CSV: upstream, the origin, downstream, then same-cultivar inventory. */
export function recallToCsv(trace: RecallTrace, labels: RecallCsvLabels): string {
  const shipments = new Map(trace.shipments.map((shipment) => [shipment.id, shipment]));
  const c = labels.columns;
  const lines = [
    [
      c.relation,
      c.generation,
      c.unit,
      c.type,
      c.cultivar,
      c.experiment,
      c.status,
      c.hold,
      c.holdReason,
      c.location,
      c.shippedTo,
      c.shipments,
    ],
    ...[...trace.upstream, trace.origin, ...trace.downstream, ...trace.sameCultivar].map((node) =>
      row(node, shipments, labels)
    ),
  ];
  return lines.map((cells) => cells.map(escapeCsvCell).join(",")).join("\r\n") + "\r\n";
}
