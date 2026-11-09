import { uploadExperimentDocument } from "@/features/experiment/documents";
import { uploadExperimentDocumentFieldsSchema } from "@/features/experiment/schemas";
import { MAX_UPLOAD_BYTES } from "@/lib/file-types";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const form = await ctx.request.formData().catch(() => {
    throw errors.validation("The upload could not be read");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw errors.validation("A file is required");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw errors.validation(`Files can be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const fields = uploadExperimentDocumentFieldsSchema.safeParse({ label: form.get("label") ?? "" });
  if (!fields.success) {
    throw errors.validation(
      fields.error.issues[0]?.message ?? "Invalid upload",
      fields.error.issues
    );
  }

  const result = await uploadExperimentDocument(
    ctx.user,
    experimentId,
    { label: fields.data.label, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
    ctx.meta
  );
  return { ok: true, id: result.documentId };
});
