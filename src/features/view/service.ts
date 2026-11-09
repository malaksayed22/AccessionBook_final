import "server-only";
import type { SessionUser } from "@/lib/auth";
import { normalizeViewQuery, type ViewList } from "@/lib/table-view";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { SaveViewInput } from "./schemas";

/*
 * Saved views are a member's own way of looking at a list: they hold no laboratory data and change
 * none, so they are not audited, and nobody else sees them.
 */

/** The member's saved views of a list, by name. */
export async function listViews(user: SessionUser, list: ViewList) {
  return prisma.savedView.findMany({
    where: { userId: user.id, list },
    orderBy: { name: "asc" },
    select: { id: true, name: true, query: true },
  });
}

/** Saves the view under its name; saving again under the same name replaces it. */
export async function saveView(actor: SessionUser, input: SaveViewInput) {
  const query = normalizeViewQuery(input.query);
  return prisma.savedView.upsert({
    where: { userId_list_name: { userId: actor.id, list: input.list, name: input.name } },
    create: { userId: actor.id, list: input.list, name: input.name, query },
    update: { query },
    select: { id: true, name: true, query: true },
  });
}

export async function deleteView(actor: SessionUser, id: number) {
  const { count } = await prisma.savedView.deleteMany({ where: { id, userId: actor.id } });
  if (count === 0) throw errors.notFound("View");
}
