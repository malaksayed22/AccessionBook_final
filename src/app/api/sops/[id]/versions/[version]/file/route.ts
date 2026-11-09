import { readSopFile } from "@/features/sop/files";
import { assertSopsEnabled } from "@/features/sop/enabled";
import { parseId, withApi } from "@/server/http";

/** Authenticated download of a version's document: always a download, never sniffed. */
export const GET = withApi<{ id: string; version: string }>({ auth: "user" }, async (ctx) => {
  assertSopsEnabled();
  const sopId = parseId(ctx.params.id, "procedure");
  const version = parseId(ctx.params.version, "version");
  const { fileName, mime, body } = await readSopFile(sopId, version);
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});
