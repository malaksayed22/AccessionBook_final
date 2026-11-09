import { z } from "zod";
import { listNotifications } from "@/features/notification/queries";
import { markAllNotificationsRead, markNotificationRead } from "@/features/notification/service";
import { withApi } from "@/server/http";

/** The bell: the newest notices and how many are unread. */
export const GET = withApi({ auth: "user" }, async (ctx) => {
  const { rows, unread } = await listNotifications(ctx.user, { page: 1, limit: 8 });
  return { ok: true, unread, notifications: rows };
});

const markSchema = z.union([
  z.object({ id: z.number().int().positive() }),
  z.object({ all: z.literal(true) }),
]);

/** Marks one notice, or all of them, read. */
export const POST = withApi({ auth: "user" }, async (ctx) => {
  const input = await ctx.json(markSchema);
  if ("all" in input) await markAllNotificationsRead(ctx.user);
  else await markNotificationRead(ctx.user, input.id);
  return { ok: true };
});
