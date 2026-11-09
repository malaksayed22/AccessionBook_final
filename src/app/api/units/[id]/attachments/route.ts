import { uploadAttachment } from "@/features/unit/documents";
import { uploadAttachmentFieldsSchema } from "@/features/unit/schemas";
import { MAX_UPLOAD_BYTES } from "@/lib/file-types";
import { errors } from "@/server/errors";
import { parseId, withApi } from "@/server/http";

export const POST = withApi<{ id: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const form = await ctx.request.formData().catch(() => {
    throw errors.validation("The upload could not be read");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw errors.validation("A file is required");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw errors.validation(`Files can be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const fields = uploadAttachmentFieldsSchema.safeParse({
    label: form.get("label"),
    category: String(form.get("category") ?? "photo").toUpperCase(),
  });
  if (!fields.success) {
    throw errors.validation(
      fields.error.issues[0]?.message ?? "Invalid upload",
      fields.error.issues
    );
  }

  const result = await uploadAttachment(
    ctx.user,
    unitId,
    { ...fields.data, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
    ctx.meta
  );
  return { ok: true, id: result.attachmentId };
});
