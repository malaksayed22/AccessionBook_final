import { recordLocale, recordResponse } from "@/features/record/common";
import { buildUnitRecord } from "@/features/unit/record";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

/**
 * The unit's record as a PDF download, in the reader's language (`?locale=fr`). Anyone who can open
 * the unit can download it; it is read from the audit trail and changes nothing.
 */
export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const file = await buildUnitRecord(ctx.user, unitId, recordLocale(ctx.request));
  if (!file) throw errors.notFound("Unit");
  return recordResponse(file);
});
