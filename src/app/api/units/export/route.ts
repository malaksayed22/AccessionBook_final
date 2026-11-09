import {
  listUnits,
  UNIT_LIST_SORTS,
  UNIT_LIST_STAGES,
  UNIT_LIST_STATUSES,
  type UnitListRow,
} from "@/features/unit/queries";
import { pickParam, positiveIntParam } from "@/lib/list-params";
import { escapeCsvCell } from "@/lib/reports/csv";
import { withApi } from "@/server/http";

const TYPES = ["PLANT", "SEEDLOT", "FLOWER", "CULTURE"] as const;
/** One download holds at most this many units; narrow the filters for more. */
const EXPORT_LIMIT = 5000;

/** `ids=4,8,15`: the rows chosen on the page, when only those are exported. */
function idsParam(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(",").flatMap((part) => {
    const id = positiveIntParam(part.trim());
    return id ? [id] : [];
  });
  return ids.length > 0 ? ids.slice(0, EXPORT_LIMIT) : undefined;
}

const HEADER = [
  "Unit",
  "Type",
  "Cultivar",
  "Experiment",
  "Location",
  "Stage",
  "Status",
  "Nothing left",
  "Wet weight (g)",
  "Dry weight (g)",
  "Seeds",
  "Last updated",
];

function line(unit: UnitListRow): string {
  return [
    unit.name,
    unit.type,
    unit.cultivarName,
    unit.experiment?.ecode ?? null,
    unit.locationName,
    unit.growthStage,
    unit.status,
    unit.nothingLeft ? "yes" : "no",
    unit.left.wetGrams,
    unit.left.dryGrams,
    unit.left.seeds,
    unit.lastUpdated.toISOString(),
  ]
    .map(escapeCsvCell)
    .join(",");
}

/**
 * The units list as CSV, with the same search and filters as the page (or only the rows chosen on
 * it) and only the units the reader may see. Column names, codes and dates are English/ISO, like
 * the regulatory exports.
 */
export const GET = withApi({ auth: "user" }, async (ctx) => {
  const params = new URL(ctx.request.url).searchParams;
  const get = (key: string) => params.get(key) ?? undefined;
  const { rows } = await listUnits(ctx.user, {
    q: get("q")?.trim() || undefined,
    status: pickParam(get("status"), UNIT_LIST_STATUSES),
    type: pickParam(get("type"), TYPES),
    stage: pickParam(get("stage"), UNIT_LIST_STAGES),
    locationId: positiveIntParam(get("location")),
    ids: idsParam(get("ids")),
    sort: pickParam(get("sort"), UNIT_LIST_SORTS) ?? "date",
    order: get("order") === "asc" ? "asc" : "desc",
    page: 1,
    limit: EXPORT_LIMIT,
  });
  const csv = [HEADER.map(escapeCsvCell).join(","), ...rows.map(line)].join("\r\n") + "\r\n";
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="units-${day}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
