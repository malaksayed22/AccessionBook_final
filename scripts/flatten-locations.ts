import "dotenv/config";
import { retireLocation } from "../src/features/location/service";
import { moveUnitTx } from "../src/features/unit/service";
import type { SessionUser } from "../src/lib/auth";
import { NO_STOCK_KINDS } from "../src/lib/stock-kinds";
import { prisma } from "../src/server/db";

/**
 * Locations became rooms only (team lead, 2026-11-07). This moves every unit stored on a level
 * inside a room (a row, rack or shelf) up to that room, as a recorded move in its history, then
 * retires the empty levels. Nothing is deleted: past states still point at the levels. A unit on
 * hold cannot move, so it stays where it is and its level stays open; the script says which. A unit
 * that does not fit in its room (the room's limit) goes to the `--overflow` room instead, when given.
 * Safe to re-run.
 *
 *   npm run db:flatten-locations -- --actor <existing admin username> [--overflow <room name>]
 */
async function main() {
  const actorName = process.argv[process.argv.indexOf("--actor") + 1];
  if (!actorName || actorName.startsWith("--"))
    throw new Error("Pass --actor <existing admin username>");
  const adminRow = await prisma.user.findFirst({
    where: { name: { equals: actorName, mode: "insensitive" }, active: true, permissions: "ADMIN" },
  });
  if (!adminRow) throw new Error(`"${actorName}" is not an active admin`);
  const admin: SessionUser = { id: adminRow.id, name: adminRow.name, permissions: "ADMIN" };
  const overflowName = process.argv.includes("--overflow")
    ? process.argv[process.argv.indexOf("--overflow") + 1]
    : undefined;
  const overflow = overflowName
    ? await prisma.location.findFirst({
        where: {
          name: { equals: overflowName, mode: "insensitive" },
          parentId: null,
          active: true,
        },
        select: { id: true, name: true },
      })
    : null;
  if (overflowName && !overflow) throw new Error(`"${overflowName}" is not an active room`);

  const all = await prisma.location.findMany({
    select: { id: true, name: true, parentId: true, active: true },
  });
  const byId = new Map(all.map((l) => [l.id, l]));
  /** The room a level sits in: the top of its chain. */
  const roomOf = (id: number) => {
    let cursor = byId.get(id);
    const seen = new Set<number>();
    while (cursor?.parentId && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = byId.get(cursor.parentId);
    }
    return cursor;
  };

  const levels = all.filter((l) => l.parentId !== null);
  let moved = 0;
  const stuck: string[] = [];
  for (const level of levels) {
    const room = roomOf(level.id);
    if (!room || room.id === level.id) continue;
    const units = await prisma.biologicalUnit.findMany({
      where: {
        currentState: { is: { locationId: level.id, kind: { notIn: [...NO_STOCK_KINDS] } } },
      },
      select: { id: true, name: true },
    });
    const moveTo = (target: { id: number; name: string }, unitId: number) =>
      prisma.$transaction((tx) =>
        moveUnitTx(
          tx,
          admin,
          unitId,
          {
            toLocationId: target.id,
            comment: `Locations are rooms only: recorded in ${target.name} (was ${level.name})`,
          },
          { requireScan: false }
        )
      );
    for (const unit of units) {
      try {
        await moveTo(room, unit.id);
        moved += 1;
      } catch (error) {
        const full = /capacity/i.test((error as Error).message);
        if (full && overflow) {
          try {
            await moveTo(overflow, unit.id);
            moved += 1;
            console.log(`  ${unit.name} did not fit in ${room.name}: recorded in ${overflow.name}`);
            continue;
          } catch (again) {
            stuck.push(`${unit.name} on ${level.name}: ${(again as Error).message}`);
            continue;
          }
        }
        stuck.push(`${unit.name} on ${level.name}: ${(error as Error).message}`);
      }
    }
  }

  let retired = 0;
  for (const level of levels) {
    const fresh = await prisma.location.findUnique({ where: { id: level.id } });
    if (!fresh?.active) continue;
    try {
      await retireLocation(admin, level.id, {
        reason: "Locations are rooms only; its units were recorded in the room",
      });
      retired += 1;
    } catch (error) {
      stuck.push(`${level.name} stays open: ${(error as Error).message}`);
    }
  }

  console.log(`Moved ${moved} unit(s) up to their room; retired ${retired} level(s).`);
  for (const line of stuck) console.log(`  not done: ${line}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
