import { createOrganizationSchema } from "@/features/organization/schemas";
import { listOrganizationOptions } from "@/features/organization/queries";
import { createOrganization } from "@/features/organization/service";
import { withApi } from "@/server/http";

export const GET = withApi({ auth: "user" }, async () => {
  return { ok: true, organizations: await listOrganizationOptions() };
});

export const POST = withApi({ auth: "admin" }, async (ctx) => {
  const input = await ctx.json(createOrganizationSchema);
  const organization = await createOrganization(ctx.user, input, ctx.meta);
  return { ok: true, organization };
});
