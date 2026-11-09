import { exportMemberData } from "@/features/member/service";
import { parseId, withApi } from "@/server/http";

/**
 * Access request: downloads everything held about one member as JSON. Administrators only; each
 * export is itself written to the audit trail.
 */
export const GET = withApi<{ id: string }, "admin">({ auth: "admin" }, async (ctx) => {
  const id = parseId(ctx.params.id, "member");
  const data = await exportMemberData(ctx.user, id, ctx.meta);
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="member-${String(id).padStart(4, "0")}-export-${day}.json"`,
    },
  });
});
