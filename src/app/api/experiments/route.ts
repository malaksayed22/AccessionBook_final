import { NextResponse } from "next/server";
import { createExperimentSchema } from "@/features/experiment/schemas";
import { createExperiment } from "@/features/experiment/service";
import { AppError } from "@/server/errors";
import { withApi } from "@/server/http";

export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(createExperimentSchema);
  try {
    const result = await createExperiment(ctx.user, input, ctx.meta);
    return { ok: true, ...result };
  } catch (error) {
    // The wizard offers an explicit override when the chosen location would go over capacity, so
    // it needs to tell this conflict apart from any other (the generic error body has no details).
    const details =
      error instanceof AppError ? (error.details as { capacityExceeded?: true }) : null;
    if (error instanceof AppError && error.code === "CONFLICT" && details?.capacityExceeded) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message, capacityExceeded: true },
        { status: error.status }
      );
    }
    throw error;
  }
});
