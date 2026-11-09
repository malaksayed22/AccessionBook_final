import { listIncidents } from "@/features/qa/queries";
import { openIncidentSchema } from "@/features/qa/schemas";
import { openIncident } from "@/features/qa/service";
import { withApi } from "@/server/http";

export const GET = withApi({ auth: "user" }, async (ctx) => {
  return { incidents: await listIncidents(ctx.user, { limit: 200 }) };
});

export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(openIncidentSchema);
  const result = await openIncident(ctx.user, input, ctx.meta);
  return { ok: true, incident: { id: result.incidentId }, autoHeld: result.autoHeld };
});
