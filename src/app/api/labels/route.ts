import { recordLocale } from "@/features/record/common";
import { buildLabels, labelResponse } from "@/features/label/build";
import { labelRequestSchema } from "@/features/label/schemas";
import { errors } from "@/server/errors";
import { withApi } from "@/server/http";

/**
 * Labels as a PDF sized for the chosen stock: `?for=unit|experiment|shipment|location&id=…&template=…`,
 * with `skip` for a part-used sheet and `copies` for one record's label.
 */
export const GET = withApi({ auth: "user" }, async (ctx) => {
  const query = Object.fromEntries(new URL(ctx.request.url).searchParams);
  const parsed = labelRequestSchema.safeParse(query);
  if (!parsed.success) {
    throw errors.validation(
      parsed.error.issues[0]?.message ?? "Invalid request",
      parsed.error.issues
    );
  }
  const file = await buildLabels(ctx.user, parsed.data, recordLocale(ctx.request));
  if (!file) throw errors.notFound("Record");
  return labelResponse(file);
});
