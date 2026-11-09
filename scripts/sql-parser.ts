import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zoneOffsetMinutes } from "../src/lib/lab-time";

/**
 * Reader for the legacy Cannabase MySQL-style dump. It understands the INSERT statements
 * (single or extended, one or many per table), quoted strings with backslash and doubled-quote
 * escapes, NULL, and numbers. It never executes anything.
 */
export type SqlValue = string | number | boolean | null;
export type SqlRow = SqlValue[];
/** A row keyed by normalised column name (see `normalizeColumn`). */
export type SqlRecord = Record<string, SqlValue>;

type InsertStatement = { columns: string[]; rows: SqlRow[] };

/** `Start_Date`, `` `startDate` `` and `startdate` all become `startdate`. */
export function normalizeColumn(name: string): string {
  return name.replace(/[`"'\s_]/g, "").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STRING_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "0": "\0",
  b: "\b",
  Z: "\x1a",
};

/** Parses every `INSERT INTO <table> … VALUES …;` statement of one table, in file order. */
function parseStatements(sql: string, table: string): InsertStatement[] {
  const header = new RegExp(
    `INSERT\\s+(?:IGNORE\\s+)?INTO\\s+[\`"]?${escapeRegExp(table)}[\`"]?\\s*(?:\\(([^)]*)\\))?\\s*VALUES\\s*`,
    "gi"
  );
  const statements: InsertStatement[] = [];
  let position = 0;

  for (;;) {
    header.lastIndex = position;
    const match = header.exec(sql);
    if (!match) return statements;

    const columns = (match[1] ?? "")
      .split(",")
      .map((column) => normalizeColumn(column))
      .filter(Boolean);
    const { rows, end } = parseRows(sql, match.index + match[0].length);
    statements.push({ columns, rows });
    position = end;
  }
}

function parseRows(sql: string, start: number): { rows: SqlRow[]; end: number } {
  const rows: SqlRow[] = [];
  let current: SqlRow = [];
  let token = "";
  let quoted = false;
  let inString = false;
  let stringChar = "";
  let inRow = false;
  let i = start;

  const pushToken = () => {
    if (quoted) {
      current.push(token.replace(/&#39;/g, "'"));
    } else {
      const text = token.trim();
      if (text.toUpperCase() === "NULL") current.push(null);
      else if (/^-?\d+(\.\d+)?$/.test(text)) current.push(Number(text));
      else if (text.toUpperCase() === "TRUE") current.push(true);
      else if (text.toUpperCase() === "FALSE") current.push(false);
      else current.push(text.replace(/&#39;/g, "'"));
    }
    token = "";
    quoted = false;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inString) {
      if (ch === "\\" && next !== undefined) {
        token += STRING_ESCAPES[next] ?? next;
        i += 2;
        continue;
      }
      if (ch === stringChar) {
        if (next === stringChar) {
          token += ch;
          i += 2;
          continue;
        }
        inString = false;
        quoted = true;
        i++;
        continue;
      }
      token += ch;
      i++;
      continue;
    }

    if (ch === "(" && !inRow) {
      inRow = true;
      current = [];
      token = "";
      quoted = false;
    } else if (ch === ")" && inRow) {
      pushToken();
      rows.push(current);
      current = [];
      inRow = false;
    } else if (ch === ",") {
      if (inRow) pushToken();
    } else if (ch === ";") {
      return { rows, end: i + 1 };
    } else if ((ch === "'" || ch === '"') && inRow) {
      inString = true;
      stringChar = ch;
      token = "";
    } else if (inRow && !quoted) {
      token += ch;
    }
    i++;
  }
  return { rows, end: sql.length };
}

/** Positional rows of a table (all its INSERT statements). Kept for callers that index by column. */
export function parseSqlInserts(sql: string, table: string): SqlRow[] {
  return parseStatements(sql, table).flatMap((statement) => statement.rows);
}

/**
 * Rows keyed by column name. The INSERT's own column list wins; where a statement has no column
 * list, or fewer names than values, `fallbackColumns` names the positions. Names are normalised
 * (`normalizeColumn`), so pass `fallbackColumns` already normalised.
 */
export function parseSqlRecords(
  sql: string,
  tables: string | readonly string[],
  fallbackColumns: readonly string[]
): SqlRecord[] {
  const names = typeof tables === "string" ? [tables] : tables;
  const records: SqlRecord[] = [];
  for (const table of names) {
    for (const statement of parseStatements(sql, table)) {
      for (const row of statement.rows) {
        const record: SqlRecord = {};
        row.forEach((value, index) => {
          const column = statement.columns[index] ?? fallbackColumns[index];
          if (column) record[column] = value;
        });
        records.push(record);
      }
    }
  }
  return records;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Reads the dump from `filePath`, or from `CANNABASE_SQL_PATH`. There is deliberately no default
 * location: pointing the importer at the wrong file must be an explicit act.
 */
export function loadCannabaseSql(filePath?: string): string {
  const resolved = filePath ?? process.env.CANNABASE_SQL_PATH;
  if (!resolved) {
    throw new Error("No dump given: pass --dump <file.sql> or set CANNABASE_SQL_PATH.");
  }
  return fs.readFileSync(path.resolve(resolved), "utf-8");
}

export function decodeHtml(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** Legacy dates carry no zone; this reads them as the machine's local time. Prefer `parseDateInZone`. */
export function parseDate(value: string | number | boolean | null | undefined): Date | null {
  if (value == null || typeof value === "boolean") return null;
  const str = String(value).trim();
  if (!str || str.toUpperCase() === "NULL") return null;
  const normalized = str.includes("T") ? str : str.replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;

/**
 * A legacy timestamp (`2025-01-12 09:00:00`, no zone) is the wall-clock time in the laboratory's
 * zone; this returns the instant it denotes. Strings that carry their own zone (`Z`, `+02:00`)
 * are used as given. MySQL zero dates and anything unparseable give null.
 */
export function parseDateInZone(
  value: string | number | boolean | null | undefined,
  zone: string
): Date | null {
  if (value == null || typeof value === "boolean") return null;
  const text = String(value).trim();
  if (!text || text.toUpperCase() === "NULL" || text.startsWith("0000-00-00")) return null;

  const match = WALL_CLOCK.exec(text);
  if (!match) {
    const direct = new Date(text);
    return Number.isNaN(direct.getTime()) ? null : direct;
  }

  const [, y, mo, d, h = "0", mi = "0", s = "0", fraction = "0"] = match;
  const wallClockAsUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    Math.floor(Number(`0.${fraction}`) * 1000)
  );
  if (Number.isNaN(wallClockAsUtc)) return null;
  // The offset differs between the guess and the true instant around a DST change; settle it.
  let instant = wallClockAsUtc - zoneOffsetMinutes(new Date(wallClockAsUtc), zone) * 60_000;
  instant = wallClockAsUtc - zoneOffsetMinutes(new Date(instant), zone) * 60_000;
  return new Date(instant);
}
