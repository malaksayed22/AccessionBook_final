import { patchUnitSchema, updateUnitDetailsSchema } from "@/features/unit/schemas";
import { editUnit } from "@/features/unit/service";
import { parseId, withApi } from "@/server/http";

export const PATCH = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const body = await ctx.json(patchUnitSchema);

  const detailsPresent = body.comment !== undefined || body.sex !== undefined;
  const details = detailsPresent
    ? updateUnitDetailsSchema.parse({ comment: body.comment, sex: body.sex })
    : undefined;
  const t = body.tracking;
  const result = await editUnit(
    ctx.user,
    unitId,
    {
      details,
      locationId: t?.locationId,
      growthStage: t?.growthStage ?? undefined,
      measure: {
        humidWeight: t?.humidWeight ?? body.plant?.humidWeight,
        dryWeight: t?.dryWeight ?? body.plant?.dryWeight,
        seedCount: t?.seedCount,
      },
    },
    ctx.meta
  );
  return result.applied.length === 0
    ? { ok: true, unchanged: true }
    : { ok: true, changes: result.applied };
});
