import { buildExperimentRecord } from "@/features/experiment/record";
import { recordLocale, recordResponse } from "@/features/record/common";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

/**
 * The experiment's record (its batch record) as a PDF download, in the reader's language
 * (`?locale=fr`). Anyone who can open the experiment can download it; it changes nothing.
 */
export const GET = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const file = await buildExperimentRecord(ctx.user, experimentId, recordLocale(ctx.request));
  if (!file) throw errors.notFound("Experiment");
  return recordResponse(file);
});
