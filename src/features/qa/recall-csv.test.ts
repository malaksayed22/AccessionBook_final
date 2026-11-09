import { describe, expect, it } from "vitest";
import { recallToCsv, type RecallCsvLabels } from "./recall-csv";
import type { RecallNode, RecallTrace } from "./recall";

const labels: RecallCsvLabels = {
  columns: {
    relation: "Relation",
    generation: "Generation",
    unit: "Unit",
    type: "Type",
    cultivar: "Cultivar",
    experiment: "Experiment",
    status: "Status",
    hold: "Hold",
    holdReason: "Hold reason",
    location: "Location",
    shippedTo: "Shipped to",
    shipments: "Shipments",
  },
  relation: { self: "Origin", ancestor: "Up", descendant: "Down", "same-cultivar": "Peer" },
  standing: {
    active: "Active",
    "on-hold": "On hold",
    destroyed: "Destroyed",
  },
  type: { PLANT: "Plant", SEEDLOT: "Seed lot", FLOWER: "Flower", CULTURE: "Culture" },
  holdKind: { HOLD: "Hold" },
};

const node = (patch: Partial<RecallNode>): RecallNode => ({
  id: 1,
  name: "MOM",
  type: "PLANT",
  relation: "self",
  generation: 0,
  parentId: null,
  standing: "active",
  hold: null,
  cultivar: "Northern Lights",
  cultivarId: 5,
  experiment: { id: 1, ecode: "AB1" },
  locationName: "Room 1",
  locationId: 2,
  nothingLeft: false,
  shippedTo: [],
  shipmentIds: [],
  ...patch,
});

const trace = (patch: Partial<RecallTrace>): RecallTrace => ({
  origin: node({}),
  upstream: [],
  downstream: [],
  sameCultivar: [],
  sameCultivarTotal: 0,
  truncated: false,
  shipments: [],
  organizations: [],
  counts: {
    upstream: 0,
    downstream: 0,
    sameCultivar: 0,
    inInventory: 1,
    onHold: 0,
    shipped: 0,
    destroyed: 0,
    shipments: 0,
    organizations: 0,
  },
  ...patch,
});

describe("recallToCsv", () => {
  it("writes a header and the upstream, origin and downstream rows in that order", () => {
    const csv = recallToCsv(
      trace({
        upstream: [node({ id: 9, name: "ROOT", relation: "ancestor", generation: -1 })],
        downstream: [
          node({
            id: 2,
            name: "CL-1",
            relation: "descendant",
            generation: 1,
            nothingLeft: true,
            locationName: null,
            shippedTo: [{ id: 4, name: "Acme Labs" }],
            shipmentIds: [7],
          }),
        ],
        shipments: [
          {
            id: 7,
            reference: "SHP-1",
            direction: "OUTBOUND",
            status: "DELIVERED",
            organization: { id: 4, name: "Acme Labs", licenceNumber: null },
            unitNames: ["CL-1"],
            units: [{ id: 2, name: "CL-1" }],
          },
        ],
      }),
      labels
    );
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Relation,Generation,Unit,Type,Cultivar,Experiment,Status,Hold,Hold reason,Location,Shipped to,Shipments"
    );
    expect(lines.map((l) => l.split(",")[2])).toEqual(["Unit", "ROOT", "MOM", "CL-1"]);
    expect(lines[3]).toBe("Down,1,CL-1,Plant,Northern Lights,AB1,Active,,,,Acme Labs,SHP-1");
  });

  it("quotes commas and neutralises spreadsheet formulas in free text", () => {
    const csv = recallToCsv(
      trace({
        origin: node({
          standing: "on-hold",
          hold: {
            kind: "HOLD",
            origin: "MANUAL",
            reason: '=HYPERLINK("x"), mites',
            placedAt: new Date("2026-01-01T00:00:00Z"),
          },
        }),
      }),
      labels
    );
    expect(csv).toContain(`"'=HYPERLINK(""x""), mites"`);
  });
});
