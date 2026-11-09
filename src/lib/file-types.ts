/**
 * Upload safety. The type of a file is decided from its *bytes*, never from the name the browser
 * sends or its claimed MIME type, and only a short allow-list is accepted. HTML, SVG, scripts and
 * archives are rejected outright: an uploaded file must never be able to run in the application's origin.
 * The one kind of archive accepted is a Word document or Excel workbook (a ZIP in the Office Open
 * XML layout), and only without macros or embedded binaries; files are always served as downloads.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type DetectedFile = {
  ext: "pdf" | "png" | "jpg" | "webp" | "csv" | "txt" | "docx" | "xlsx";
  mime: string;
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The names of the entries in a ZIP file, read from its central directory, or null when the bytes
 * are not a well-formed ZIP. Nothing is decompressed.
 */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits in the last 22 bytes plus an optional comment.
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  let end = -1;
  for (let i = bytes.length - 22; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const names: string[] = [];
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength > bytes.length) return null;
    names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** A Word document or Excel workbook with no macros, ActiveX controls or embedded binaries. */
function detectOfficeDocument(bytes: Uint8Array): DetectedFile | null {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return null;
  const names = zipEntryNames(bytes);
  if (!names || !names.includes("[Content_Types].xml")) return null;
  const unsafe = names.some(
    (name) =>
      /vbaProject|vbaData|activeX/i.test(name) ||
      /\.(bin|exe|dll|js|vbs|ps1|bat|cmd|jar)$/i.test(name) ||
      name.startsWith("/") ||
      name.split("/").includes("..")
  );
  if (unsafe) return null;
  if (names.includes("word/document.xml")) return { ext: "docx", mime: DOCX_MIME };
  if (names.includes("xl/workbook.xml")) return { ext: "xlsx", mime: XLSX_MIME };
  return null;
}

/** Valid UTF-8 with no control characters other than tab, CR and LF. */
function looksLikePlainText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  const decode = (chunk: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(chunk);
  let text: string;
  try {
    text = decode(sample);
  } catch {
    // Only a file longer than the sample can have a character cut by the boundary; a short
    // file that fails to decode is simply not UTF-8.
    if (bytes.length <= sample.length) return false;
    try {
      text = decode(sample.subarray(0, sample.length - 3));
    } catch {
      return false;
    }
  }
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
}

/** Returns the detected type, or null when the file is not on the allow-list. */
export function detectFileType(bytes: Uint8Array, originalName: string): DetectedFile | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { ext: "pdf", mime: "application/pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: "png", mime: "image/png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  const office = detectOfficeDocument(bytes);
  if (office) return office;

  // Plain text is only accepted for explicitly text-like names, and only if it really is text.
  const extension = originalName.toLowerCase().split(".").pop();
  if ((extension === "csv" || extension === "txt") && looksLikePlainText(bytes)) {
    return extension === "csv"
      ? { ext: "csv", mime: "text/csv; charset=utf-8" }
      : { ext: "txt", mime: "text/plain; charset=utf-8" };
  }
  return null;
}

/** A display-only file name: no path parts, control characters or markup. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001F<>:"|?*]/g, "_").trim();
  return (cleaned || "file").slice(0, 150);
}
