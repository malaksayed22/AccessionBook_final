/**
 * The unpackaged-inventory section of Health Canada's monthly cannabis tracking report, as laid out
 * in its reporting form (flh-cannabis-tracking-reporting-form.csv, columns A to JS): the three
 * reporting-period columns, then 14 classes of cannabis, each with its own set of lines. The column
 * headers are built from this table and must match the form word for word (see the test).
 *
 * Quantities are whole numbers for seeds and plants and kilograms (at most four decimals) for every
 * other class. Value columns ($) are part of the form but Accession Book records no book value.
 */

export const CTLS_CLASS_IDS = [
  "seeds",
  "vegetativePlants",
  "wholePlants",
  "freshCannabis",
  "driedCannabis",
  "purchasedHemp",
  "pureIntermediates",
  "ediblesSolids",
  "ediblesNonSolids",
  "extractsInhaled",
  "extractsIngested",
  "extractsOther",
  "topicals",
  "other",
] as const;
export type CtlsClassId = (typeof CTLS_CLASS_IDS)[number];

/** Every line a class can have, in the form's order. */
export const CTLS_LINE_IDS = [
  "opening",
  "produced",
  "receivedDomestic",
  "receivedImported",
  "receivedReturned",
  "additionsOther",
  "processed",
  "processedEdiblesSolids",
  "processedEdiblesNonSolids",
  "processedExtractsIngested",
  "processedExtractsInhaled",
  "processedExtractsOther",
  "processedTopicals",
  "packaged",
  "shippedTesters",
  "shippedResearchers",
  "shippedCultivators",
  "exported",
  "exportedValue",
  "shippedReturned",
  "dryingLoss",
  "destroyed",
  "lostStolen",
  "reductionsOther",
  "closing",
  "closingValue",
] as const;
export type CtlsLineId = (typeof CTLS_LINE_IDS)[number];

export type CtlsMeasure = "#" | "kg";

export const ADDITION_LINES = [
  "produced",
  "receivedDomestic",
  "receivedImported",
  "receivedReturned",
  "additionsOther",
] as const satisfies readonly CtlsLineId[];

export const REDUCTION_LINES = [
  "processed",
  "processedEdiblesSolids",
  "processedEdiblesNonSolids",
  "processedExtractsIngested",
  "processedExtractsInhaled",
  "processedExtractsOther",
  "processedTopicals",
  "packaged",
  "shippedTesters",
  "shippedResearchers",
  "shippedCultivators",
  "exported",
  "shippedReturned",
  "dryingLoss",
  "destroyed",
  "lostStolen",
  "reductionsOther",
] as const satisfies readonly CtlsLineId[];

/** Lines that carry a dollar value, not a quantity. */
export const VALUE_LINES: ReadonlySet<CtlsLineId> = new Set(["exportedValue", "closingValue"]);

/** Each line as the form words it (after the class name). */
export const CTLS_LINE_TEXT: Record<CtlsLineId, string> = {
  opening: "Opening inventory",
  produced: "Additions - Produced",
  receivedDomestic: "Additions - Received - domestic",
  receivedImported: "Additions - Received - imported",
  receivedReturned: "Additions - Received - returned",
  additionsOther: "Additions - Other",
  processed: "Reductions - Processed",
  processedEdiblesSolids: "Reductions - Processed - Edibles - Solids",
  processedEdiblesNonSolids: "Reductions - Processed - Edibles - Non-solids",
  processedExtractsIngested: "Reductions - Processed - Extracts - Ingested",
  processedExtractsInhaled: "Reductions - Processed - Extracts - Inhaled",
  processedExtractsOther: "Reductions - Processed - Extracts - Other",
  processedTopicals: "Reductions - Processed - Topicals",
  packaged: "Reductions - Packaged and labeled",
  shippedTesters: "Reductions - Shipped - domestic - to analytical testers",
  shippedResearchers: "Reductions - Shipped - domestic - to researchers",
  shippedCultivators: "Reductions - Shipped - domestic - To cultivators and processors",
  exported: "Reductions - Shipped - exported",
  exportedValue: "Reductions - Shipped - exported value",
  shippedReturned: "Reductions - Shipped - returned",
  dryingLoss: "Reductions - Adjustment for drying / processing loss",
  destroyed: "Reductions - Destroyed",
  lostStolen: "Reductions - Lost/stolen",
  reductionsOther: "Reductions - Other",
  closing: "Closing inventory",
  closingValue: "Closing inventory value",
};

export type CtlsClass = {
  id: CtlsClassId;
  /** The class as the form names it. */
  name: string;
  measure: CtlsMeasure;
  lines: readonly CtlsLineId[];
};

const FULL: readonly CtlsLineId[] = [
  "opening",
  ...ADDITION_LINES,
  "processed",
  "packaged",
  "shippedTesters",
  "shippedResearchers",
  "shippedCultivators",
  "exported",
  "exportedValue",
  "shippedReturned",
  "dryingLoss",
  "destroyed",
  "lostStolen",
  "reductionsOther",
  "closing",
  "closingValue",
];
const without = (...lines: CtlsLineId[]) => FULL.filter((line) => !lines.includes(line));
const PURE_INTERMEDIATES = FULL.flatMap((line): CtlsLineId[] =>
  line === "processed"
    ? [
        "processedEdiblesSolids",
        "processedEdiblesNonSolids",
        "processedExtractsIngested",
        "processedExtractsInhaled",
        "processedExtractsOther",
        "processedTopicals",
      ]
    : [line]
);

export const CTLS_CLASSES: readonly CtlsClass[] = [
  { id: "seeds", name: "Seeds", measure: "#", lines: without("dryingLoss") },
  { id: "vegetativePlants", name: "Vegetative cannabis plants", measure: "#", lines: FULL },
  { id: "wholePlants", name: "Whole cannabis plants", measure: "#", lines: FULL },
  { id: "freshCannabis", name: "Fresh cannabis", measure: "kg", lines: FULL },
  { id: "driedCannabis", name: "Dried cannabis", measure: "kg", lines: FULL },
  {
    id: "purchasedHemp",
    name: "Purchased hemp",
    measure: "kg",
    lines: without("produced", "receivedReturned"),
  },
  { id: "pureIntermediates", name: "Pure Intermediates", measure: "kg", lines: PURE_INTERMEDIATES },
  { id: "ediblesSolids", name: "Edibles - Solids", measure: "kg", lines: without("processed") },
  {
    id: "ediblesNonSolids",
    name: "Edibles - Non-solids",
    measure: "kg",
    lines: without("processed"),
  },
  { id: "extractsInhaled", name: "Extracts - Inhaled", measure: "kg", lines: without("processed") },
  {
    id: "extractsIngested",
    name: "Extracts - Ingested",
    measure: "kg",
    lines: without("processed"),
  },
  { id: "extractsOther", name: "Extracts - Other", measure: "kg", lines: without("processed") },
  { id: "topicals", name: "Topicals", measure: "kg", lines: without("processed") },
  { id: "other", name: "Other", measure: "kg", lines: FULL },
];

/**
 * The classes Accession Book can hold: seed lots, plants (by stage) and harvested material (fresh
 * until a dry weight is recorded). The others are always zero for a laboratory that does not
 * process or package cannabis.
 */
export const TRACKED_CLASS_IDS = [
  "seeds",
  "vegetativePlants",
  "wholePlants",
  "freshCannabis",
  "driedCannabis",
] as const satisfies readonly CtlsClassId[];
export type TrackedClassId = (typeof TRACKED_CLASS_IDS)[number];

/** The lines shown on screen for the tracked classes: quantities only, in the form's order. */
export const DISPLAY_LINE_IDS = [
  "opening",
  ...ADDITION_LINES,
  "processed",
  "packaged",
  "shippedTesters",
  "shippedResearchers",
  "shippedCultivators",
  "exported",
  "shippedReturned",
  "dryingLoss",
  "destroyed",
  "lostStolen",
  "reductionsOther",
  "closing",
] as const satisfies readonly CtlsLineId[];
export type DisplayLineId = (typeof DISPLAY_LINE_IDS)[number];

export function ctlsClass(id: CtlsClassId): CtlsClass {
  const found = CTLS_CLASSES.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown CTLS class ${id}`);
  return found;
}

export function hasLine(classId: CtlsClassId, line: CtlsLineId): boolean {
  return ctlsClass(classId).lines.includes(line);
}

/** The unit a line is reported in: dollars for values, kilograms for drying loss (even on plants). */
export function lineMeasure(cls: CtlsClass, line: CtlsLineId): CtlsMeasure | "$" {
  if (VALUE_LINES.has(line)) return "$";
  if (line === "dryingLoss") return "kg";
  return cls.measure;
}

export const PERIOD_HEADERS = [
  "Reporting Period Year (####)",
  "Reporting Period Month (##)",
  "Licence ID",
] as const;

/** Columns A to JS of the reporting form, in order. */
export function ctlsFormHeaders(): string[] {
  return [
    ...PERIOD_HEADERS,
    ...CTLS_CLASSES.flatMap((cls) =>
      cls.lines.map(
        (line) => `Unpackaged - ${cls.name} - ${CTLS_LINE_TEXT[line]} (${lineMeasure(cls, line)})`
      )
    ),
  ];
}

/** Line quantities per class, in the form's units (counts, or kilograms). */
export type CtlsFormValues = Partial<Record<CtlsClassId, Partial<Record<CtlsLineId, number>>>>;

/**
 * The data row under `ctlsFormHeaders()`. Quantities the laboratory does not have are 0 (the form
 * asks for zeros rather than blanks); value columns are left blank because no book value is kept.
 */
export function ctlsFormRow(
  period: { year: number; month: number; licenceId: string | null },
  values: CtlsFormValues
): Array<string | number> {
  return [
    String(period.year),
    String(period.month).padStart(2, "0"),
    period.licenceId ?? "",
    ...CTLS_CLASSES.flatMap((cls) =>
      cls.lines.map((line) => (VALUE_LINES.has(line) ? "" : (values[cls.id]?.[line] ?? 0)))
    ),
  ];
}
