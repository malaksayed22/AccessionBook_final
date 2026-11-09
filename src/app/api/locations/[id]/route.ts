import { locationCommandSchema } from "@/features/location/schemas";
import { reactivateLocation, retireLocation, updateLocation } from "@/features/location/service";
import { parseId, withApi } from "@/server/http";

/** Edit a location's details, retire it (only while empty) or bring a retired one back. */
export const PATCH = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const id = parseId(ctx.params.id, "location");
  const command = await ctx.json(locationCommandSchema);
  switch (command.action) {
    case "update": {
      const { action: _action, ...input } = command;
      return { ok: true, location: await updateLocation(ctx.user, id, input, ctx.meta) };
    }
    case "retire":
      return { ok: true, location: await retireLocation(ctx.user, id, command, ctx.meta) };
    case "reactivate":
      return { ok: true, location: await reactivateLocation(ctx.user, id, ctx.meta) };
  }
});
