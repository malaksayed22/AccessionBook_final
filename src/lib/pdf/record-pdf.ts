import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";

/**
 * A printable record (of a unit or an experiment) as plain data, and its layout as a PDF file. The
 * feature code builds the data in the reader's language; this module only lays it out: a title block
 * with a QR code back to the live page, sections of fields, figures and tables, and a footer with
 * the page number on every page. Tables break across pages and repeat their header row.
 *
 * The built-in PDF fonts (Helvetica) cover Western European text, French included. Any other
 * character is printed as its plain letter (an accent dropped) or, failing that, "?".
 */

export type PdfColumn = {
  header: string;
  /** Share of the table's width; the shares of a table need not add up to 1. */
  width: number;
  align?: "start" | "end";
};

export type PdfBlock =
  /** Label and value pairs, two to a row, like the fields of a form. */
  | { kind: "fields"; fields: ReadonlyArray<{ label: string; value: string }> }
  /** Key figures in boxes, up to four to a row. */
  | { kind: "figures"; figures: ReadonlyArray<{ label: string; value: string; note?: string }> }
  | {
      kind: "table";
      columns: readonly PdfColumn[];
      rows: ReadonlyArray<readonly string[]>;
      /** A last row in bold, under a rule. */
      total?: readonly string[];
    }
  | { kind: "text"; text: string; muted?: boolean };

export type PdfSection = { title: string; blocks: readonly PdfBlock[] };

export type PdfRecord = {
  /** BCP 47 language of the text, for the file's metadata. */
  language: string;
  /** The product name, over the title. */
  brand: string;
  /** What kind of record this is: "Unit record". */
  title: string;
  /** What it is about, printed large: the unit's name. */
  subject: string;
  subtitle?: string;
  /** Small lines under the subject: when and by whom it was generated, the licence. */
  meta: readonly string[];
  /** A QR code to the live page, printed at the top right. */
  qr?: { url: string; caption: string };
  /** The left side of every page's footer. */
  footer: string;
  /** The right side, e.g. "Page 2 of 5" in the reader's language. */
  pageNumber: (page: number, total: number) => string;
  author: string;
  generatedAt: Date;
  sections: readonly PdfSection[];
};

// US Letter, the paper size used in Canada.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 48;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 64;
const FOOTER_Y = 34;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X;
const BLOCK_GAP = 10;
const SECTION_GAP = 18;
const LINE_HEIGHT = 1.32;

// The application's light theme: ink, secondary text, borders, the accent, a soft fill.
const INK = hex("#0a1226");
const MUTED = hex("#424c6b");
const RULE = hex("#d9deec");
const ACCENT = hex("#1b2f78");
const FILL = hex("#f2f4fa");
const WHITE = rgb(1, 1, 1);

function hex(value: string): RGB {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Characters the built-in fonts lack, mapped to ones they have. */
const REPLACEMENTS: Readonly<Record<string, string>> = {
  // Narrow and thin spaces (French number formatting uses U+202F) print as a no-break space.
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
  "‐": "-",
  "‑": "-",
  "−": "-",
  "←": "<-",
  "→": "->",
  "≤": "<=",
  "≥": ">=",
  "≈": "~",
  "\t": " ",
  "\r": "",
};

/** `text` with every character the font cannot print replaced; line breaks are kept. */
export function toPrintableText(text: string, supported: ReadonlySet<number>): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\n" || supported.has(code)) {
      out += char;
      continue;
    }
    const replaced = REPLACEMENTS[char];
    if (replaced !== undefined) {
      out += replaced;
      continue;
    }
    const plain = char.normalize("NFKD").replace(/\p{M}/gu, "");
    const printable = plain !== "" && [...plain].every((c) => supported.has(c.codePointAt(0) ?? 0));
    out += printable ? plain : "?";
  }
  return out;
}

/**
 * Breaks printable text into lines no wider than `width`: at spaces (a no-break space holds), and
 * inside a word only when the word alone is wider than the line.
 */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const fits = (value: string) => font.widthOfTextAtSize(value, size) <= width;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ").filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (!fits(rest) && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

type TextStyle = { font: PDFFont; size: number; color: RGB };

class Layout {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private cursor = 0;
  private readonly supported: ReadonlySet<number>;

  constructor(
    private readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont
  ) {
    this.supported = new Set(regular.getCharacterSet());
    this.addPage();
  }

  get y() {
    return this.cursor;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.cursor = PAGE_HEIGHT - MARGIN_TOP;
  }

  /** Moves to a new page unless `height` more points fit on this one. */
  ensure(height: number) {
    if (this.cursor - height < MARGIN_BOTTOM && this.cursor < PAGE_HEIGHT - MARGIN_TOP) {
      this.addPage();
    }
  }

  down(points: number) {
    this.cursor -= points;
  }

  printable(text: string): string {
    return toPrintableText(text, this.supported);
  }

  lines(text: string, style: TextStyle, width: number): string[] {
    return wrapText(this.printable(text), style.font, style.size, width);
  }

  /** Draws lines from the top edge `top`; returns the height they take. */
  drawLines(
    lines: readonly string[],
    style: TextStyle,
    x: number,
    top: number,
    options: { width?: number; align?: "start" | "end" | "center" } = {}
  ): number {
    const step = style.size * LINE_HEIGHT;
    lines.forEach((line, index) => {
      const lineWidth = style.font.widthOfTextAtSize(line, style.size);
      const offset =
        options.width === undefined || options.align === undefined || options.align === "start"
          ? 0
          : options.align === "end"
            ? options.width - lineWidth
            : (options.width - lineWidth) / 2;
      this.page.drawText(line, {
        x: x + offset,
        y: top - style.size - index * step,
        font: style.font,
        size: style.size,
        color: style.color,
      });
    });
    return lines.length * step;
  }

  rule(top: number, color: RGB = RULE, thickness = 0.6, x = MARGIN_X, width = CONTENT_WIDTH) {
    this.page.drawLine({
      start: { x, y: top },
      end: { x: x + width, y: top },
      thickness,
      color,
    });
  }

  box(x: number, top: number, width: number, height: number, fill: RGB, border?: RGB) {
    this.page.drawRectangle({
      x,
      y: top - height,
      width,
      height,
      color: fill,
      borderColor: border,
      borderWidth: border ? 0.6 : 0,
    });
  }

  qr(url: string, x: number, top: number, size: number) {
    const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
    const cell = size / modules.size;
    this.box(x, top, size, size, WHITE);
    for (let row = 0; row < modules.size; row++) {
      let start = -1;
      for (let col = 0; col <= modules.size; col++) {
        const dark = col < modules.size && modules.get(row, col) === 1;
        if (dark && start < 0) start = col;
        if (!dark && start >= 0) {
          this.box(x + start * cell, top - row * cell, (col - start) * cell, cell, INK);
          start = -1;
        }
      }
    }
  }
}

const styles = (layout: Layout) => ({
  brand: { font: layout.bold, size: 9.5, color: ACCENT },
  title: { font: layout.regular, size: 9.5, color: MUTED },
  subject: { font: layout.bold, size: 20, color: INK },
  subtitle: { font: layout.regular, size: 10.5, color: MUTED },
  meta: { font: layout.regular, size: 8.5, color: MUTED },
  heading: { font: layout.bold, size: 11.5, color: INK },
  label: { font: layout.regular, size: 7.5, color: MUTED },
  value: { font: layout.regular, size: 9.5, color: INK },
  figure: { font: layout.bold, size: 13, color: INK },
  head: { font: layout.bold, size: 7.5, color: MUTED },
  cell: { font: layout.regular, size: 8.5, color: INK },
  total: { font: layout.bold, size: 8.5, color: INK },
  text: { font: layout.regular, size: 9, color: INK },
  muted: { font: layout.regular, size: 9, color: MUTED },
  footer: { font: layout.regular, size: 7.5, color: MUTED },
});

type Styles = ReturnType<typeof styles>;

const QR_SIZE = 76;

function drawTitleBlock(layout: Layout, s: Styles, record: PdfRecord) {
  const top = layout.y;
  const textWidth = record.qr ? CONTENT_WIDTH - QR_SIZE - 20 : CONTENT_WIDTH;
  let y = top;
  const brand = layout.lines(record.brand, s.brand, textWidth);
  layout.drawLines(brand, s.brand, MARGIN_X, y);
  const brandWidth = s.brand.font.widthOfTextAtSize(brand[0] ?? "", s.brand.size);
  layout.drawLines(
    layout.lines(`·  ${record.title}`, s.title, textWidth - brandWidth - 6),
    s.title,
    MARGIN_X + brandWidth + 6,
    y
  );
  y -= s.brand.size * LINE_HEIGHT + 6;
  y -= layout.drawLines(layout.lines(record.subject, s.subject, textWidth), s.subject, MARGIN_X, y);
  if (record.subtitle) {
    y -= 2;
    y -= layout.drawLines(
      layout.lines(record.subtitle, s.subtitle, textWidth),
      s.subtitle,
      MARGIN_X,
      y
    );
  }
  y -= 6;
  for (const line of record.meta) {
    y -= layout.drawLines(layout.lines(line, s.meta, textWidth), s.meta, MARGIN_X, y);
  }

  let bottom = y;
  if (record.qr) {
    const x = MARGIN_X + CONTENT_WIDTH - QR_SIZE;
    layout.qr(record.qr.url, x, top, QR_SIZE);
    const caption = layout.lines(record.qr.caption, s.label, QR_SIZE + 16);
    const captionHeight = layout.drawLines(caption, s.label, x - 8, top - QR_SIZE - 4, {
      width: QR_SIZE + 16,
      align: "center",
    });
    bottom = Math.min(bottom, top - QR_SIZE - 4 - captionHeight);
  }
  layout.down(top - bottom + 10);
  layout.rule(layout.y, ACCENT, 1.2);
  layout.down(SECTION_GAP);
}

/** `keep`: how much of what follows must fit under the heading, so it never ends a page alone. */
function drawHeading(layout: Layout, s: Styles, title: string, keep: number) {
  layout.ensure(s.heading.size * LINE_HEIGHT + 11 + keep);
  layout.down(
    layout.drawLines(layout.lines(title, s.heading, CONTENT_WIDTH), s.heading, MARGIN_X, layout.y)
  );
  layout.down(3);
  layout.rule(layout.y);
  layout.down(8);
}

function drawFields(
  layout: Layout,
  s: Styles,
  fields: ReadonlyArray<{ label: string; value: string }>
) {
  const gap = 20;
  const width = (CONTENT_WIDTH - gap) / 2;
  for (let index = 0; index < fields.length; index += 2) {
    const pair = fields.slice(index, index + 2).map((field) => ({
      label: layout.lines(field.label, s.label, width),
      value: layout.lines(field.value, s.value, width),
    }));
    const heights = pair.map(
      (cell) =>
        cell.label.length * s.label.size * LINE_HEIGHT +
        1 +
        cell.value.length * s.value.size * LINE_HEIGHT
    );
    const height = Math.max(...heights) + 7;
    layout.ensure(height);
    const top = layout.y;
    pair.forEach((cell, column) => {
      const x = MARGIN_X + column * (width + gap);
      const labelHeight = layout.drawLines(cell.label, s.label, x, top);
      layout.drawLines(cell.value, s.value, x, top - labelHeight - 1);
      layout.rule(top - height + 2, RULE, 0.4, x, width);
    });
    layout.down(height + 3);
  }
}

function drawFigures(
  layout: Layout,
  s: Styles,
  figures: ReadonlyArray<{ label: string; value: string; note?: string }>
) {
  const perRow = Math.min(4, Math.max(1, figures.length));
  const gap = 8;
  const width = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
  const pad = 7;
  const inner = width - 2 * pad;
  for (let index = 0; index < figures.length; index += perRow) {
    if (index > 0) layout.down(gap);
    const row = figures.slice(index, index + perRow).map((figure) => ({
      label: layout.lines(figure.label, s.label, inner),
      value: layout.lines(figure.value, s.figure, inner),
      note: figure.note ? layout.lines(figure.note, s.label, inner) : [],
    }));
    const height =
      Math.max(
        ...row.map(
          (cell) =>
            cell.label.length * s.label.size * LINE_HEIGHT +
            2 +
            cell.value.length * s.figure.size * LINE_HEIGHT +
            (cell.note.length ? 2 + cell.note.length * s.label.size * LINE_HEIGHT : 0)
        )
      ) +
      2 * pad;
    layout.ensure(height);
    const top = layout.y;
    row.forEach((cell, column) => {
      const x = MARGIN_X + column * (width + gap);
      layout.box(x, top, width, height, FILL, RULE);
      let y = top - pad;
      y -= layout.drawLines(cell.label, s.label, x + pad, y) + 2;
      y -= layout.drawLines(cell.value, s.figure, x + pad, y);
      if (cell.note.length) layout.drawLines(cell.note, s.label, x + pad, y - 2);
    });
    layout.down(height);
  }
}

function drawTable(layout: Layout, s: Styles, block: Extract<PdfBlock, { kind: "table" }>) {
  const share = block.columns.reduce((sum, column) => sum + column.width, 0) || 1;
  const widths = block.columns.map((column) => (column.width / share) * CONTENT_WIDTH);
  const padX = 4;
  const padY = 3.5;
  const pageRoom = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;

  const measure = (cells: readonly string[], style: TextStyle) => {
    const lines = widths.map((width, column) =>
      layout.lines(cells[column] ?? "", style, width - 2 * padX)
    );
    const step = style.size * LINE_HEIGHT;
    return { lines, height: Math.max(...lines.map((cell) => cell.length)) * step + 2 * padY };
  };
  const header = measure(
    block.columns.map((column) => column.header),
    s.head
  );

  const drawRow = (row: { lines: string[][]; height: number }, style: TextStyle, fill?: RGB) => {
    const top = layout.y;
    if (fill) layout.box(MARGIN_X, top, CONTENT_WIDTH, row.height, fill);
    let x = MARGIN_X;
    row.lines.forEach((lines, column) => {
      const width = widths[column] ?? 0;
      layout.drawLines(lines, style, x + padX, top - padY, {
        width: width - 2 * padX,
        align: block.columns[column]?.align ?? "start",
      });
      x += width;
    });
    layout.down(row.height);
  };
  const drawHeader = () => {
    drawRow(header, s.head, FILL);
    layout.rule(layout.y, MUTED, 0.6);
  };

  // A row taller than a page is cut to what fits, so the table always ends.
  const fit = (row: { lines: string[][]; height: number }, style: TextStyle) => {
    const step = style.size * LINE_HEIGHT;
    const maxLines = Math.max(1, Math.floor((pageRoom - header.height - 2 * padY) / step));
    if (row.height <= pageRoom - header.height) return row;
    const lines = row.lines.map((cell) =>
      cell.length > maxLines
        ? [...cell.slice(0, maxLines - 1), `${cell[maxLines - 1] ?? ""}…`]
        : cell
    );
    return { lines, height: maxLines * step + 2 * padY };
  };

  layout.ensure(header.height + 24);
  drawHeader();
  for (const cells of block.rows) {
    const row = fit(measure(cells, s.cell), s.cell);
    if (layout.y - row.height < MARGIN_BOTTOM) {
      layout.addPage();
      drawHeader();
    }
    drawRow(row, s.cell);
    layout.rule(layout.y, RULE, 0.4);
  }
  if (block.total) {
    const row = fit(measure(block.total, s.total), s.total);
    layout.ensure(row.height);
    layout.rule(layout.y, MUTED, 0.6);
    drawRow(row, s.total);
  }
}

function drawText(layout: Layout, s: Styles, block: Extract<PdfBlock, { kind: "text" }>) {
  const style = block.muted ? s.muted : s.text;
  const step = style.size * LINE_HEIGHT;
  for (const line of layout.lines(block.text, style, CONTENT_WIDTH)) {
    layout.ensure(step);
    layout.down(layout.drawLines([line], style, MARGIN_X, layout.y));
  }
}

function drawFooters(layout: Layout, s: Styles, record: PdfRecord) {
  const total = layout.pages.length;
  layout.pages.forEach((page, index) => {
    const number = layout.printable(record.pageNumber(index + 1, total));
    const numberWidth = s.footer.font.widthOfTextAtSize(number, s.footer.size);
    const footer = layout.lines(record.footer, s.footer, CONTENT_WIDTH - numberWidth - 24)[0] ?? "";
    page.drawLine({
      start: { x: MARGIN_X, y: FOOTER_Y + 12 },
      end: { x: MARGIN_X + CONTENT_WIDTH, y: FOOTER_Y + 12 },
      thickness: 0.4,
      color: RULE,
    });
    page.drawText(footer, { x: MARGIN_X, y: FOOTER_Y, ...s.footer });
    page.drawText(number, {
      x: MARGIN_X + CONTENT_WIDTH - numberWidth,
      y: FOOTER_Y,
      ...s.footer,
    });
  });
}

/** Lays the record out and returns the PDF file. */
export async function renderRecordPdf(record: PdfRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${record.title} - ${record.subject}`, { showInWindowTitleBar: true });
  doc.setSubject(record.title);
  doc.setAuthor(record.author);
  doc.setCreator(record.brand);
  doc.setProducer(record.brand);
  doc.setLanguage(record.language);
  doc.setCreationDate(record.generatedAt);
  doc.setModificationDate(record.generatedAt);

  const layout = new Layout(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold)
  );
  const s = styles(layout);

  drawTitleBlock(layout, s, record);
  for (const section of record.sections) {
    // A line of text (such as "None recorded.") is short; anything else needs a few lines of room.
    drawHeading(layout, s, section.title, section.blocks[0]?.kind === "text" ? 16 : 60);
    section.blocks.forEach((block, index) => {
      if (index > 0) layout.down(BLOCK_GAP);
      if (block.kind === "fields") drawFields(layout, s, block.fields);
      else if (block.kind === "figures") drawFigures(layout, s, block.figures);
      else if (block.kind === "table") drawTable(layout, s, block);
      else drawText(layout, s, block);
    });
    layout.down(SECTION_GAP);
  }
  drawFooters(layout, s, record);
  return doc.save();
}
