import { readExperimentDocument, voidExperimentDocument } from "@/features/experiment/documents";
import { voidAttachmentSchema } from "@/features/unit/schemas";
import { parseId, withApi } from "@/server/http";

/** Authenticated download: never served from a public folder, always a download, never sniffed. */
export const GET = withApi<{ id: string; documentId: string }>({ auth: "user" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const documentId = parseId(ctx.params.documentId, "document");
  const { document, body } = await readExperimentDocument(ctx.user, experimentId, documentId);

  const ascii = document.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": document.mimeType ?? "application/octet-stream",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});

/** Removes a document from view. Voided, never deleted; the reason is mandatory. */
export const DELETE = withApi<{ id: string; documentId: string }>({ auth: "user" }, async (ctx) => {
  const experimentId = parseId(ctx.params.id, "experiment");
  const documentId = parseId(ctx.params.documentId, "document");
  const input = await ctx.json(voidAttachmentSchema);
  await voidExperimentDocument(ctx.user, experimentId, documentId, input, ctx.meta);
  return { ok: true };
});
