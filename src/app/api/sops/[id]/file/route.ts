import { attachSopFile } from "@/features/sop/files";
import { assertSopsEnabled } from "@/features/sop/enabled";
import { MAX_UPLOAD_BYTES } from "@/lib/file-types";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

/** Attaches the controlled document (PDF or Word) to the procedure's draft version. */
export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  assertSopsEnabled();
  const sopId = parseId(ctx.params.id, "procedure");
  const form = await ctx.request.formData().catch(() => {
    throw errors.validation("The upload could not be read");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw errors.validation("A file is required");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw errors.validation(`Files can be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const result = await attachSopFile(
    ctx.user,
    sopId,
    { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
    ctx.meta
  );
  return { ok: true, ...result };
});
