import { deriveIntoNewExperiment } from "@/features/experiment/service";
import { deriveUnitSchema } from "@/features/unit/schemas";
import { deriveUnits } from "@/features/unit/service";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const parentId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(deriveUnitSchema);
  const result = input.newExperiment
    ? await deriveIntoNewExperiment(
        ctx.user,
        parentId,
        { ...input, newExperiment: input.newExperiment },
        ctx.meta
      )
    : { ...(await deriveUnits(ctx.user, parentId, input, ctx.meta)), experiment: null };
  return {
    ok: true,
    units: result.units.map((u) => ({ unitId: u.id, unitName: u.name })),
    unitId: result.units[0]?.id,
    unitName: result.units[0]?.name,
    parentName: result.parentName,
    deriveType: result.deriveType,
    childType: result.childType,
    experiment: result.experiment,
  };
});
