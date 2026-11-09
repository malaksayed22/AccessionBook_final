import JsBarcode from "jsbarcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { LABEL_TEMPLATES, labelPositions, type LabelTemplateId } from "@/lib/labels/templates";
import { toPrintableText } from "./record-pdf";

/**
 * Labels as a PDF at the exact size of the label stock, so the printer puts each one on its label
 * when printed at 100 % ("actual size"). A label has a QR code to its live page on the left, its
 * title in bold, a few lines under it and, where the label is wide enough for a scanner to read
 * it, a Code 128 barcode of the value the move form asks to be scanned. Labels are black on white.
 */

export type LabelContent = {
  /** Printed large and in bold: the unit's name, the shipment's reference. */
  title: string;
  /** Smaller lines under the title, as many as fit. */
  lines: readonly string[];
  /** A link printed as a QR code. */
  qr?: string;
  /** A value printed as a Code 128 barcode. */
  barcode?: string;
};

export type LabelDocument = {
  template: LabelTemplateId;
  labels: readonly LabelContent[];
  /** Labels left empty at the start of a part-used sheet. */
  skip?: number;
  title: string;
  author: string;
  brand: string;
  /** BCP 47 language of the text, for the file's metadata. */
  language: string;
  generatedAt: Date;
};

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const LINE_HEIGHT = 1.2;
// The narrowest bar, in points (about 0.2 mm), that a desk scanner reads from a laser print.
const MIN_BAR = 0.55;
// Code 128 needs ten bars' width of white on each side.
const QUIET_ZONE = 10;
// Labels shorter than this have no room for a readable barcode under the text.
const MIN_BARCODE_LABEL_HEIGHT = 60;

type Box = { x: number; top: number; width: number; height: number };
type Fonts = { regular: PDFFont; bold: PDFFont; supported: ReadonlySet<number> };

export async function renderLabelPdf(document: LabelDocument): Promise<Uint8Array> {
  const template = LABEL_TEMPLATES[document.template];
  const doc = await PDFDocument.create();
  doc.setTitle(document.title, { showInWindowTitleBar: true });
  doc.setAuthor(document.author);
  doc.setCreator(document.brand);
  doc.setProducer(document.brand);
  doc.setLanguage(document.language);
  doc.setCreationDate(document.generatedAt);
  doc.setModificationDate(document.generatedAt);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: Fonts = {
    regular,
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    supported: new Set(regular.getCharacterSet()),
  };

  const pages: PDFPage[] = [];
  const pageAt = (index: number) => {
    while (pages.length <= index) {
      pages.push(doc.addPage([template.page.width, template.page.height]));
    }
    return pages[index]!;
  };
  if (document.labels.length === 0) pageAt(0);

  const positions = labelPositions(template, document.labels.length, document.skip);
  document.labels.forEach((label, index) => {
    const position = positions[index]!;
    drawLabel(pageAt(position.page), fonts, label, {
      x: position.x,
      top: template.page.height - position.y,
      width: template.label.width,
      height: template.label.height,
    });
  });
  return doc.save();
}

function drawLabel(page: PDFPage, fonts: Fonts, label: LabelContent, box: Box) {
  const pad = clamp(box.height * 0.08, 3, 10);
  const inner = box.height - 2 * pad;
  const bars = label.barcode ? barcodeBars(label.barcode) : null;
  const barHeight = box.height * 0.24;

  let qrSize = label.qr ? Math.min(inner, box.width * 0.42) : 0;
  const textColumn = () => {
    const x = box.x + pad + (qrSize > 0 ? qrSize + pad : 0);
    return { x, width: box.x + box.width - pad - x };
  };
  let text = textColumn();

  // The barcode goes under the text when it fits there, else across the foot of the label with a
  // smaller QR code, else not at all (the QR code still opens the record).
  let barcode: { x: number; width: number } | null = null;
  let textBottom = box.top - box.height + pad;
  if (bars && box.height >= MIN_BARCODE_LABEL_HEIGHT) {
    const across = { x: box.x + pad, width: box.width - 2 * pad };
    if (barWidth(text.width, bars) >= MIN_BAR) {
      barcode = text;
    } else if (barWidth(across.width, bars) >= MIN_BAR) {
      barcode = across;
      qrSize = Math.min(qrSize, inner - barHeight - pad);
      text = textColumn();
    }
    if (barcode) textBottom += barHeight + pad / 2;
  }

  if (label.qr && qrSize > 0) drawQr(page, label.qr, box.x + pad, box.top - pad, qrSize);
  if (barcode && bars) {
    drawBars(page, bars, barcode.x, box.top - box.height + pad, barcode.width, barHeight);
  }

  const titleSize = clamp(box.height * 0.16, 6.5, 16);
  const lineSize = clamp(box.height * 0.1, 5, 9);
  let cursor = box.top - pad;
  const title = fitText(
    toPrintableText(label.title, fonts.supported),
    fonts.bold,
    titleSize,
    text.width
  );
  page.drawText(title.text, {
    x: text.x,
    y: cursor - title.size,
    size: title.size,
    font: fonts.bold,
    color: BLACK,
  });
  cursor -= title.size * LINE_HEIGHT + lineSize * 0.2;
  for (const line of label.lines) {
    if (cursor - lineSize < textBottom) break;
    const fitted = fitText(
      toPrintableText(line, fonts.supported),
      fonts.regular,
      lineSize,
      text.width,
      false
    );
    page.drawText(fitted.text, {
      x: text.x,
      y: cursor - lineSize,
      size: lineSize,
      font: fonts.regular,
      color: BLACK,
    });
    cursor -= lineSize * LINE_HEIGHT;
  }
}

/**
 * The text at `size`, or smaller (down to 6 points) when `shrink` allows, cut with an ellipsis when
 * it still does not fit the width.
 */
function fitText(text: string, font: PDFFont, size: number, width: number, shrink = true) {
  let current = size;
  while (shrink && current > 6 && font.widthOfTextAtSize(text, current) > width) current -= 0.5;
  if (font.widthOfTextAtSize(text, current) <= width) return { text, size: current };
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, current) > width)
    cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, size: current };
}

/**
 * The value's Code 128 bars as a string of ones (bar) and zeros (space), or null when Code 128
 * cannot encode it (an accented letter, for one): the label then goes without a barcode.
 */
export function barcodeBars(value: string): string | null {
  const target: { encodings?: Array<{ data: string }> } = {};
  try {
    JsBarcode(target, value, { format: "CODE128" });
  } catch {
    return null;
  }
  return target.encodings?.map((encoding) => encoding.data).join("") || null;
}

function barWidth(width: number, bars: string) {
  return width / (bars.length + 2 * QUIET_ZONE);
}

function drawBars(
  page: PDFPage,
  bars: string,
  x: number,
  bottom: number,
  width: number,
  height: number
) {
  const bar = barWidth(width, bars);
  let start = -1;
  for (let i = 0; i <= bars.length; i++) {
    const dark = i < bars.length && bars[i] === "1";
    if (dark && start < 0) start = i;
    if (!dark && start >= 0) {
      page.drawRectangle({
        x: x + (QUIET_ZONE + start) * bar,
        y: bottom,
        width: (i - start) * bar,
        height,
        color: BLACK,
      });
      start = -1;
    }
  }
}

function drawQr(page: PDFPage, url: string, x: number, top: number, size: number) {
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  const cell = size / modules.size;
  page.drawRectangle({ x, y: top - size, width: size, height: size, color: WHITE });
  for (let row = 0; row < modules.size; row++) {
    let start = -1;
    for (let col = 0; col <= modules.size; col++) {
      const dark = col < modules.size && modules.get(row, col) === 1;
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        page.drawRectangle({
          x: x + start * cell,
          y: top - (row + 1) * cell,
          width: (col - start) * cell,
          height: cell,
          color: BLACK,
        });
        start = -1;
      }
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
