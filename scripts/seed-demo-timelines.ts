import "dotenv/config";
import { completeExperiment, createExperiment } from "../src/features/experiment/service";
import { placeHold } from "../src/features/qa/service";
import { changeStage, destroyUnit } from "../src/features/unit/service";
import type { SessionUser } from "../src/lib/auth";
import { prisma } from "../src/server/db";

/**
 * More demo experiments, to show what the experiment cards and pages draw: units of every type,
 * moving through the lifecycle stages on different days, with some on hold, destroyed or still
 * waiting, and one experiment that is completed. Built through the real services, so every rule
 * applies. Safe to re-run: it does nothing once the first experiment exists.
 *
 *   npm run db:seed-timelines -- --actor <existing admin username>
 */
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);
const FIRST = "Demo: Blue Dream flowering trial";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("The demo seed never runs in production.");
  const actorName = process.argv[process.argv.indexOf("--actor") + 1];
  if (!actorName || actorName.startsWith("--"))
    throw new Error("Pass --actor <existing admin username>");
  const adminRow = await prisma.user.findFirst({
    where: { name: { equals: actorName, mode: "insensitive" }, active: true, permissions: "ADMIN" },
  });
  if (!adminRow) throw new Error(`"${actorName}" is not an active admin`);
  const admin: SessionUser = { id: adminRow.id, name: adminRow.name, permissions: "ADMIN" };

  if (await prisma.experiment.findFirst({ where: { name: FIRST } })) {
    console.log("Demo timelines already present; nothing to do.");
    return;
  }

  const members = await prisma.user.findMany({
    where: {
      active: true,
      permissions: "REGULAR",
      name: { in: ["Amira Hassan", "Julien Tremblay", "Sophie Gagnon"] },
    },
  });
  const person = (name: string) => members.find((m) => m.name === name)?.id;
  const team = (...names: string[]) =>
    names.flatMap((name) => (person(name) ? [person(name)!] : []));

  const cultivar = async (name: string) =>
    (await prisma.cultivar.findFirst({ where: { name } })) ??
    (await prisma.cultivar.findFirstOrThrow());
  const [dream, lights, skunk] = await Promise.all([
    cultivar("Blue Dream"),
    cultivar("Northern Lights"),
    cultivar("Skunk #1"),
  ]);
  const room = async (name: string) =>
    (await prisma.location.findFirst({ where: { name } })) ??
    (await prisma.location.findFirstOrThrow({ where: { active: true } }));
  const [vegetative, flower, drying, vault, culture] = await Promise.all([
    room("Vegetative Room"),
    room("Flower Room 1"),
    room("Drying Room"),
    room("Vault"),
    room("Tissue Culture Lab"),
  ]);

  const group = (kind: string, cultivarId: number, quantity: number, status?: string) => ({
    kind,
    cultivarId,
    cultivarMode: "SAME" as const,
    quantity,
    statusMode: "SAME" as const,
    status,
  });
  const make = (input: Record<string, unknown>) =>
    createExperiment(admin, {
      providerMode: "INTERNAL",
      sourceDescription: "Internal demo stock",
      ignoreCapacityWarning: true,
      ...input,
    } as never);
  const unitsOf = async (experimentId: number, type?: string) =>
    prisma.biologicalUnit.findMany({
      where: { experimentId, ...(type ? { type: type as never } : {}) },
      orderBy: { name: "asc" },
      select: { id: true },
    });
  const stage = async (ids: Array<{ id: number }>, toStage: string, effectiveAt: string) => {
    for (const { id } of ids) await changeStage(admin, id, { toStage, effectiveAt } as never);
  };

  // 1. Running: plants through vegetative, flowering and harvest, plus seed lots and cultures.
  const blue = await make({
    name: FIRST,
    startDate: daysAgo(120),
    estimatedEndDate: daysAhead(30),
    comment:
      "Twelve clones taken through a full flowering cycle, with seed lots and cultures on the side.",
    memberIds: team("Amira Hassan", "Julien Tremblay"),
    locationId: vegetative.id,
    unitGroups: [
      group("CLONES", dream.id, 12, "VEGETATIVE"),
      group("SEEDS", dream.id, 6),
      group("CULTURES", dream.id, 4),
    ],
  });
  const bluePlants = await unitsOf(blue.id, "PLANT");
  await stage(bluePlants, "FLOWERING", daysAgo(90));
  await stage(bluePlants.slice(0, 9), "HARVESTED", daysAgo(45));
  for (const { id } of bluePlants.slice(9, 10)) {
    await placeHold(admin, id, {
      reason: "Suspected powdery mildew, awaiting inspection",
      kind: "HOLD",
    });
  }
  for (const { id } of bluePlants.slice(0, 2)) {
    await destroyUnit(admin, id, {
      reason: "Post-harvest sampling, destroyed per SOP-14",
      effectiveAt: daysAgo(30),
    } as never);
  }

  // 2. Completed: harvested flower through drying, curing and storage.
  const skunkStudy = await make({
    name: "Demo: Skunk post-harvest curing study",
    startDate: daysAgo(200),
    memberIds: team("Sophie Gagnon"),
    locationId: drying.id,
    // Harvested flower is registered with its weight (each lot, in grams).
    unitGroups: [{ ...group("FLOWERS", skunk.id, 10, "HARVESTED"), wetWeightGrams: 420 }],
  });
  const flowers = await unitsOf(skunkStudy.id);
  await stage(flowers, "DRYING", daysAgo(190));
  await stage(flowers.slice(0, 8), "CURING", daysAgo(170));
  await stage(flowers.slice(0, 6), "STORAGE", daysAgo(140));
  await completeExperiment(admin, skunkStudy.id, { endDate: daysAgo(20) });

  // 3. Running: seed lots waiting while the plants grow on.
  const seeds = await make({
    name: "Demo: Northern Lights germination",
    startDate: daysAgo(75),
    estimatedEndDate: daysAhead(60),
    memberIds: team("Amira Hassan"),
    locationId: vegetative.id,
    unitGroups: [group("SEEDS", lights.id, 5), group("PLANTS", lights.id, 8, "VEGETATIVE")],
  });
  await stage((await unitsOf(seeds.id, "PLANT")).slice(0, 5), "FLOWERING", daysAgo(30));

  // 4. Running: young, mostly cultures.
  const tissue = await make({
    name: "Demo: Tissue culture propagation",
    startDate: daysAgo(40),
    memberIds: team("Julien Tremblay", "Sophie Gagnon"),
    locationId: culture.id,
    unitGroups: [group("CULTURES", lights.id, 6), group("CLONES", lights.id, 4, "VEGETATIVE")],
  });
  await stage((await unitsOf(tissue.id, "PLANT")).slice(0, 2), "FLOWERING", daysAgo(8));

  // 5. Running: several cultivars at once, two thirds already harvested.
  const screening = await make({
    name: "Demo: Mixed cultivar screening",
    startDate: daysAgo(150),
    estimatedEndDate: daysAhead(15),
    memberIds: team("Amira Hassan", "Sophie Gagnon"),
    locationId: flower.id,
    unitGroups: [
      group("PLANTS", dream.id, 5, "VEGETATIVE"),
      group("PLANTS", lights.id, 5, "VEGETATIVE"),
      group("PLANTS", skunk.id, 5, "VEGETATIVE"),
    ],
  });
  const screened = await unitsOf(screening.id);
  await stage(screened, "FLOWERING", daysAgo(100));
  await stage(screened.slice(0, 10), "HARVESTED", daysAgo(50));
  void vault;

  console.log("Added 5 demo experiments with stage timelines.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
