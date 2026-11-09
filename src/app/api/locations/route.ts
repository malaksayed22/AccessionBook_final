import { createLocationSchema } from "@/features/location/schemas";
import { createLocation } from "@/features/location/service";
import { withApi } from "@/server/http";

/** Admin adds a storage location. */
export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(createLocationSchema);
  const location = await createLocation(ctx.user, input, ctx.meta);
  return { ok: true, location };
});
