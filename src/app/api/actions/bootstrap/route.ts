import { getActionBootstrap } from "@/features/action/queries";
import { idSchema } from "@/features/unit/schemas";
import { errors } from "@/server/errors";
import { withApi } from "@/server/http";

/** Picker data for the "Take action" launcher; `?unitId=` adds the state of the unit it is opened on. */
export const GET = withApi({ auth: "user" }, async (ctx) => {
  const raw = new URL(ctx.request.url).searchParams.get("unitId");
  if (!raw) return getActionBootstrap(ctx.user);

  const unitId = idSchema.safeParse(raw);
  if (!unitId.success) throw errors.validation("The unit id is not valid");
  return getActionBootstrap(ctx.user, { unitId: unitId.data });
});
