import { readAttachment, voidAttachment } from "@/features/unit/documents";
import { voidAttachmentSchema } from "@/features/unit/schemas";
import { parseId, withApi } from "@/server/http";

/**
 * Authenticated download. Files are never served from a public folder; the type comes from what
 * was detected at upload, the browser is told not to sniff it, and it is always a download.
 */
export const GET = withApi<{ id: string; attachmentId: string }>({ auth: "user" }, async (ctx) => {
  const unitId = parseId(ctx.params.id, "unit");
  const attachmentId = parseId(ctx.params.attachmentId, "document");
  const { attachment, body } = await readAttachment(ctx.user, unitId, attachmentId);

  const ascii = attachment.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": attachment.mimeType ?? "application/octet-stream",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});

/**
 * Removes a document from view. It is voided, never deleted, and the reason is mandatory: the stored
 * bytes and the audit entry stay as evidence.
 */
export const DELETE = withApi<{ id: string; attachmentId: string }>(
  { auth: "user" },
  async (ctx) => {
    const unitId = parseId(ctx.params.id, "unit");
    const attachmentId = parseId(ctx.params.attachmentId, "document");
    const input = await ctx.json(voidAttachmentSchema);
    await voidAttachment(ctx.user, unitId, attachmentId, input, ctx.meta);
    return { ok: true };
  }
);
