import { readOrganizationDocument } from "@/features/organization/documents";
import { parseId, withApi } from "@/server/http";

/** Authenticated download: never served from a public folder, always a download, never sniffed. */
export const GET = withApi<{ id: string; documentId: string }>({ auth: "user" }, async (ctx) => {
  const organizationId = parseId(ctx.params.id, "organization");
  const documentId = parseId(ctx.params.documentId, "document");
  const { document, body } = await readOrganizationDocument(ctx.user, organizationId, documentId);

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
