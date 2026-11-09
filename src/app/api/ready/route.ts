export const dynamic = "force-dynamic";

import { prisma } from "@/server/db";
import { logger } from "@/server/logger";

/** Readiness: the app can serve traffic, i.e. the database answers. */
export async function GET() {
  try {
    const rows = await prisma.$queryRaw<Array<{ encoding: string }>>`
      SELECT pg_encoding_to_char(encoding) AS encoding
      FROM pg_database WHERE datname = current_database()`;
    // Records carry accented characters and symbols; any other encoding silently loses them.
    const encoding = rows[0]?.encoding;
    if (encoding !== "UTF8") throw new Error(`database encoding is ${encoding}, expected UTF8`);
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // The reason goes to the log, never to the (unauthenticated) caller.
    logger.error({ err: error }, "readiness check failed");
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
