import { getOrganizationDetail } from "@/features/organization/queries";
import { updateOrganizationSchema } from "@/features/organization/schemas";
import { updateOrganization } from "@/features/organization/service";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const detail = await getOrganizationDetail(ctx.user, parseId(ctx.params.id, "organization"), {
    inbound: 1,
    outbound: 1,
    units: 1,
    tests: 1,
  });
  if (!detail) throw errors.notFound("Organization");
  return { ok: true, profile: detail };
});

export const PATCH = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const id = parseId(ctx.params.id, "organization");
  const input = await ctx.json(updateOrganizationSchema);
  const organization = await updateOrganization(ctx.user, id, input, ctx.meta);
  return { ok: true, organization };
});
