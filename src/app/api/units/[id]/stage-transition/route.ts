import { changeStageSchema } from "@/features/unit/schemas";
import { changeStage } from "@/features/unit/service";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(changeStageSchema);
  const result = await changeStage(ctx.user, unitId, input, ctx.meta);
  return {
    ok: true,
    fromStage: result.fromStage,
    toStage: result.toStage,
    date: result.effectiveAt.toISOString(),
  };
});
