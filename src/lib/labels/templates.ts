/**
 * The label stock the lab prints on, measured in PDF points (72 to the inch). A sheet template is
 * a US Letter page of identical labels (Avery); a roll template is one label per page, the size of
 * the label itself (a Zebra thermal printer). The measurements are the manufacturer's: where the
 * first label starts on the page and the distance from one label to the next.
 */

export const LABEL_TEMPLATE_IDS = [
  "avery-5160",
  "avery-5163",
  "avery-5167",
  "zebra-4x2",
  "zebra-2x1",
] as const;

export type LabelTemplateId = (typeof LABEL_TEMPLATE_IDS)[number];

/** What a label is for: it decides what the label says and the template offered first. */
export const LABEL_KINDS = ["unit", "sample", "shipment", "location"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

export type LabelTemplate = {
  id: LabelTemplateId;
  /** A roll prints one label per page; a sheet fills a Letter page. */
  stock: "sheet" | "roll";
  page: { width: number; height: number };
  label: { width: number; height: number };
  columns: number;
  rows: number;
  /** The top left corner of the first label, from the top left of the page. */
  origin: { x: number; y: number };
  /** From one label's top left corner to the next one's, across and down. */
  pitch: { x: number; y: number };
};

const INCH = 72;
const LETTER = { width: 8.5 * INCH, height: 11 * INCH };

export const LABEL_TEMPLATES: Record<LabelTemplateId, LabelTemplate> = {
  // Address labels, 2⅝ × 1 in, 30 to a sheet: plants and seed lots.
  "avery-5160": {
    id: "avery-5160",
    stock: "sheet",
    page: LETTER,
    label: { width: 2.625 * INCH, height: 1 * INCH },
    columns: 3,
    rows: 10,
    origin: { x: 0.1875 * INCH, y: 0.5 * INCH },
    pitch: { x: 2.75 * INCH, y: 1 * INCH },
  },
  // Shipping labels, 4 × 2 in, 10 to a sheet: boxes, rooms, shelves.
  "avery-5163": {
    id: "avery-5163",
    stock: "sheet",
    page: LETTER,
    label: { width: 4 * INCH, height: 2 * INCH },
    columns: 2,
    rows: 5,
    origin: { x: 0.15625 * INCH, y: 0.5 * INCH },
    pitch: { x: 4.1875 * INCH, y: 2 * INCH },
  },
  // Return address labels, 1¾ × ½ in, 80 to a sheet: sample tubes and bags.
  "avery-5167": {
    id: "avery-5167",
    stock: "sheet",
    page: LETTER,
    label: { width: 1.75 * INCH, height: 0.5 * INCH },
    columns: 4,
    rows: 20,
    origin: { x: 0.3 * INCH, y: 0.5 * INCH },
    pitch: { x: 2.05 * INCH, y: 0.5 * INCH },
  },
  "zebra-4x2": roll(4 * INCH, 2 * INCH, "zebra-4x2"),
  "zebra-2x1": roll(2 * INCH, 1 * INCH, "zebra-2x1"),
};

function roll(width: number, height: number, id: LabelTemplateId): LabelTemplate {
  return {
    id,
    stock: "roll",
    page: { width, height },
    label: { width, height },
    columns: 1,
    rows: 1,
    origin: { x: 0, y: 0 },
    pitch: { x: width, y: height },
  };
}

/** The template offered first for each kind of label. */
export const DEFAULT_LABEL_TEMPLATE: Record<LabelKind, LabelTemplateId> = {
  unit: "avery-5160",
  sample: "avery-5167",
  shipment: "zebra-4x2",
  location: "avery-5163",
};

export function labelsPerPage(template: LabelTemplate): number {
  return template.columns * template.rows;
}

/**
 * Where each label goes, page by page, from the top left of its page. `skip` leaves the first
 * labels of a part-used sheet empty; it means nothing on a roll.
 */
export function labelPositions(
  template: LabelTemplate,
  count: number,
  skip = 0
): Array<{ page: number; x: number; y: number }> {
  const perPage = labelsPerPage(template);
  const offset = template.stock === "sheet" ? Math.min(Math.max(0, skip), perPage - 1) : 0;
  return Array.from({ length: count }, (_, index) => {
    const slot = index + offset;
    const onPage = slot % perPage;
    return {
      page: Math.floor(slot / perPage),
      x: template.origin.x + (onPage % template.columns) * template.pitch.x,
      y: template.origin.y + Math.floor(onPage / template.columns) * template.pitch.y,
    };
  });
}
