export const dynamic = "force-dynamic";

/** Liveness: the process is up. Deliberately touches nothing else. */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
