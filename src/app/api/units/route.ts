import { registerUnitSchema } from "@/features/unit/schemas";
import { registerUnits } from "@/features/unit/service";
import { withApi } from "@/server/http";

export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(registerUnitSchema);
  const { units } = await registerUnits(ctx.user, input, ctx.meta);
  return {
    ok: true,
    units: units.map((u) => ({ unitId: u.id, name: u.name })),
    id: units[0]?.id,
    name: units[0]?.name,
  };
});
