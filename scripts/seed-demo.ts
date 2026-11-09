import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createExperiment } from "../src/features/experiment/service";
import { placeHold, recordLabTest } from "../src/features/qa/service";
import { createShipment } from "../src/features/shipment/service";
import {
  changeStage,
  deriveUnits,
  destroyUnit,
  measureUnit,
  moveUnit,
} from "../src/features/unit/service";
import { recordActivity } from "../src/features/unit/documents";
import type { SessionUser } from "../src/lib/auth";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/server/db";

/**
 * Demo dataset for development and investor demos: a small lab with people, rooms, cultivars,
 * partners and three experiments in different phases, built through the real services so every
 * rule (holds, witnesses, custody, audit chain) is exercised. Safe to re-run: it does nothing if
 * the demo cultivars already exist. Generated demo passwords go to .local/seed-credentials.txt,
 * never to the console.
 *
 *   npm run db:seed-demo -- --actor <existing admin username>
 */
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

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

  if (await prisma.cultivar.findFirst({ where: { name: "Northern Lights" } })) {
    console.log("Demo data already present; nothing to do.");
    return;
  }

  // People ------------------------------------------------------------------
  const credentials: string[] = [];
  const makeMember = async (
    name: string,
    email: string,
    initials: string
  ): Promise<SessionUser> => {
    const password = randomBytes(15).toString("base64url");
    const user = await prisma.user.create({
      data: {
        name,
        email,
        initials,
        passwordHash: await hashPassword(password),
        permissions: "REGULAR",
      },
    });
    credentials.push(`${name}\t${email}\t${password}`);
    return { id: user.id, name: user.name, permissions: "REGULAR" };
  };
  const amira = await makeMember("Amira Hassan", "amira.hassan@example.com", "AH");
  const julien = await makeMember("Julien Tremblay", "julien.tremblay@example.com", "JT");
  const sophie = await makeMember("Sophie Gagnon", "sophie.gagnon@example.com", "SG");

  // Reference data ----------------------------------------------------------
  const rooms = Object.fromEntries(
    await Promise.all(
      [
        ["Vegetative Room", 60, "VEG-1"],
        ["Flower Room 1", 40, "FLW-1"],
        ["Drying Room", 30, "DRY-1"],
        ["Vault", 100, "VLT-1"],
        ["Tissue Culture Lab", 80, "TC-1"],
      ].map(async ([name, capacity, code]) => [
        name as string,
        await prisma.location.create({
          data: { name: name as string, capacity: capacity as number, code: code as string },
        }),
      ])
    )
  ) as Record<string, { id: number }>;
  const [lights, dream, skunk] = await Promise.all(
    [
      ["Northern Lights", 18, 1],
      ["Blue Dream", 21, 0.5],
      ["Skunk #1", 17, 0.2],
    ].map(([name, thc, cbd]) =>
      prisma.cultivar.create({
        data: {
          name: name as string,
          targetThc: thc as number,
          targetCbd: cbd as number,
          category: "Hybrid",
        },
      })
    )
  );
  const seedCo = await prisma.organization.create({
    data: {
      name: "Prairie Seed Co.",
      country: "CA",
      licenceNumber: "LIC-SEED-2231",
      address: "12 Elm Rd, Saskatoon SK",
    },
  });
  const analytica = await prisma.organization.create({
    data: { name: "Analytica Testing Labs", country: "CA", licenceNumber: "LIC-LAB-5090" },
  });

  const group = (cultivarId: number, quantity: number, status = "VEGETATIVE", kind = "CLONES") => ({
    kind,
    cultivarId,
    cultivarMode: "SAME" as const,
    quantity,
    statusMode: "SAME" as const,
    status,
  });

  // Experiment 1: internal stock, mother plant, cuttings, a lab result and a hold ------------
  const exp1 = await createExperiment(amira, {
    name: "Terpene profile stability",
    startDate: daysAgo(70),
    locationId: rooms["Vegetative Room"]!.id,
    providerMode: "INTERNAL",
    sourceDescription: "Internal mother stock, generation 3",
    unitGroups: [group(lights!.id, 6)],
  } as never);
  const [mother, ...clones] = exp1.units.map((u) => u.unitId);
  await deriveUnits(amira, mother!, { deriveType: "cutting", quantity: 4 });
  await changeStage(amira, clones[0]!, { toStage: "FLOWERING", effectiveAt: daysAgo(40) });
  await moveUnit(
    amira,
    clones[0]!,
    { toLocationId: rooms["Flower Room 1"]!.id },
    { requireScan: false }
  );
  await recordActivity(amira, clones[0]!, {
    type: "FERTIGATION",
    title: "Flower nutrient schedule A",
  });
  await changeStage(amira, clones[0]!, { toStage: "HARVESTED", effectiveAt: daysAgo(10) });
  await measureUnit(amira, clones[0]!, {
    humidWeight: 212.4,
    dryWeight: 48.9,
    effectiveAt: daysAgo(9),
  });
  await recordLabTest(amira, clones[0]!, {
    panel: "POTENCY",
    analyte: "THC",
    value: 24.6,
    uom: "%",
    labName: "Analytica Testing Labs",
  } as never);
  await placeHold(amira, clones[1]!, {
    reason: "Suspected powdery mildew, awaiting scouting report",
    kind: "HOLD",
  } as never);

  // Experiment 2: received seeds from an external supplier, shipped on, one destroyed ------------
  const exp2 = await createExperiment(julien, {
    name: "Autoflower germination trial",
    startDate: daysAgo(35),
    locationId: rooms["Vault"]!.id,
    providerMode: "EXTERNAL",
    providerOrganizationId: seedCo.id,
    unitGroups: [
      { ...group(dream!.id, 3, "", "SEEDS"), seedsPerLot: 250 },
      group(skunk!.id, 4, "VEGETATIVE", "PLANTS"),
    ],
  } as never);
  const seedLots = exp2.units.slice(0, 3).map((u) => u.unitId);
  const plants = exp2.units.slice(3).map((u) => u.unitId);
  await measureUnit(julien, seedLots[0]!, {
    seedCount: 238,
    comment: "Count after germination test",
  });
  await destroyUnit(admin, plants[3]!, {
    reason: "Failed germination and root rot; destroyed per SOP-14",
  });
  await createShipment(admin, {
    direction: "OUTBOUND",
    organizationId: analytica.id,
    status: "IN_TRANSIT",
    trackingNumber: "CP-77120931",
    items: [
      {
        unitId: plants[2]!,
        description: "Skunk #1 plant for analysis",
        materialType: "PLANT",
        unitCount: 1,
      },
    ],
  } as never);

  // Experiment 3: a sub-experiment off the first, only just started -------------------------------
  await createExperiment(sophie, {
    name: "Cutting rooting media comparison",
    startDate: daysAgo(5),
    parentExperimentId: exp1.id,
    sourceUnitId: mother!,
    locationId: rooms["Tissue Culture Lab"]!.id,
    providerMode: "INTERNAL",
    sourceDescription: "Cuttings from AH1 mother plant",
    unitGroups: [group(lights!.id, 5, "VEGETATIVE", "CLONES")],
  } as never).catch(async () => {
    // Sophie is not a member of the parent experiment, which is exactly the rule; admin does it.
    await createExperiment(admin, {
      name: "Cutting rooting media comparison",
      startDate: daysAgo(5),
      parentExperimentId: exp1.id,
      sourceUnitId: mother!,
      memberIds: [sophie.id],
      locationId: rooms["Tissue Culture Lab"]!.id,
      providerMode: "INTERNAL",
      sourceDescription: "Cuttings from AH1 mother plant",
      unitGroups: [group(lights!.id, 5, "VEGETATIVE", "CLONES")],
    } as never);
  });

  // The e2e database seeds itself too; it must not overwrite the development passwords.
  const credentialsFile = process.env.SEED_CREDENTIALS_FILE ?? ".local/seed-credentials.txt";
  mkdirSync(".local", { recursive: true });
  writeFileSync(credentialsFile, `name\temail\tpassword\n${credentials.join("\n")}\n`);

  const [units, audit] = await Promise.all([
    prisma.biologicalUnit.count(),
    prisma.auditLog.count(),
  ]);
  console.log(`Demo data created: ${units} units, ${audit} audit entries.`);
  console.log(`Demo member passwords were written to ${credentialsFile} (git-ignored).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
