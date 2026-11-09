import { listUnitTests } from "@/features/qa/queries";
import { recordLabTestSchema } from "@/features/qa/schemas";
import { recordLabTest } from "@/features/qa/service";
import { parseId, withApi } from "@/server/http";

export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const tests = await listUnitTests(parseId(ctx.params.id, "unit"));
  return { tests };
});

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const input = await ctx.json(recordLabTestSchema);
  const result = await recordLabTest(ctx.user, unitId, input, ctx.meta);
  return { ok: true, test: { id: result.testId } };
});
