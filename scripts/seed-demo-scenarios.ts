import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createCultivar } from "../src/features/cultivar/service";
import { uploadExperimentDocument } from "../src/features/experiment/documents";
import { createExperiment } from "../src/features/experiment/service";
import { createLocation, retireLocation } from "../src/features/location/service";
import { deactivateMember, inviteMember } from "../src/features/member/service";
import { uploadOrganizationDocument } from "../src/features/organization/documents";
import { createOrganization } from "../src/features/organization/service";
import { runCapaCommand } from "../src/features/qa/capa";
import {
  openIncident,
  placeHold,
  recordLabTest,
  releaseHold,
  updateIncident,
  voidIncident,
  voidLabTest,
} from "../src/features/qa/service";
import { updateLabSettings } from "../src/features/settings/service";
import { createShipment, updateShipment, voidShipment } from "../src/features/shipment/service";
import { attachSopFile } from "../src/features/sop/files";
import { createSop, updateSop } from "../src/features/sop/service";
import { createTask, updateTask } from "../src/features/task/service";
import { recordActivity, uploadAttachment } from "../src/features/unit/documents";
import { mergeGroup, splitGroup } from "../src/features/unit/groups";
import { takeSample } from "../src/features/unit/samples";
import {
  changeStage,
  destroyUnit,
  measureUnit,
  moveUnit,
  registerUnits,
} from "../src/features/unit/service";
import { takeTissueSample } from "../src/features/unit/tissue";
import { recordWaste } from "../src/features/unit/waste";
import { saveView } from "../src/features/view/service";
import type { SessionUser } from "../src/lib/auth";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/server/db";

/**
 * Scenario data on top of the demo seed and timelines, so every feature has something to show: a
 * member of every role, room levels and limits counted in plants and in weight, procedures with
 * versions and signatures, deviations with corrective actions, tissue samples and full lab panels,
 * samples, waste, plant groups split and merged, shipments in every state, tasks, documents and
 * saved views, and a recall traced from one mother to three organizations. Built through the real
 * services, so every rule applies. Safe to re-run: each part is skipped once it is there. Run it
 * after db:seed-demo and db:seed-timelines.
 *
 *   npm run db:seed-scenarios -- --actor <existing admin username>
 *
 * The demo logins' passwords come from DEMO_PASSWORDS (JSON, name to password) when it is set and
 * are generated otherwise; either way they go to SEED_CREDENTIALS_FILE, never to the console.
 */
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);
const MARKER = "SOP-001";
const RECALL_RUN = "Demo: Blue Dream production run (recall)";

const LOGINS = [
  { name: "Nadia Roy", email: "nadia.roy@example.com", initials: "NR", role: "QA" },
  { name: "Marc Bouchard", email: "marc.bouchard@example.com", initials: "MB", role: "INVENTORY" },
  { name: "Claire Dubois", email: "claire.dubois@example.com", initials: "CD", role: "INSPECTOR" },
  // The demo seed's members, so the member's view (own experiments only) can be tried too.
  { name: "Amira Hassan", email: "amira.hassan@example.com", initials: "AH", role: "REGULAR" },
  {
    name: "Julien Tremblay",
    email: "julien.tremblay@example.com",
    initials: "JT",
    role: "REGULAR",
  },
  { name: "Sophie Gagnon", email: "sophie.gagnon@example.com", initials: "SG", role: "REGULAR" },
] as const;

/** A one-page PDF, so documents open like real ones. */
async function pdf(title: string, lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText(title, { x: 56, y: 720, size: 18, font: bold });
  page.drawText("Demo document for the Accession Book test site", {
    x: 56,
    y: 698,
    size: 9,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });
  lines.forEach((line, i) => page.drawText(line, { x: 56, y: 660 - i * 20, size: 11, font }));
  return Buffer.from(await doc.save());
}

/** A small RGB PNG drawn pixel by pixel, standing in for a photo taken in the room. */
function png(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const stride = width * 3 + 1;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * stride + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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

  if (!(await prisma.cultivar.findFirst({ where: { name: "Northern Lights" } }))) {
    throw new Error("Run db:seed-demo and db:seed-timelines first.");
  }
  // Each part checks its own marker, so a part added later still runs on a database seeded before.
  const hasScenarios = !!(await prisma.sop.findUnique({ where: { code: MARKER } }));
  const hasRecall = !!(await prisma.experiment.findFirst({ where: { name: RECALL_RUN } }));
  if (hasScenarios && hasRecall) {
    console.log("Demo scenarios already present; nothing to do.");
    return;
  }
  if (!hasScenarios) await addScenarios(admin);
  if (!hasRecall) await addRecallChain(admin);

  const [units, audit] = await Promise.all([
    prisma.biologicalUnit.count(),
    prisma.auditLog.count(),
  ]);
  console.log(`Demo scenarios added: ${units} units in all, ${audit} audit entries.`);
}

async function addScenarios(admin: SessionUser) {
  // People: one login per role ---------------------------------------------------------------
  const supplied = JSON.parse(process.env.DEMO_PASSWORDS ?? "{}") as Record<string, string>;
  const credentials: string[] = [];
  const people: Record<string, SessionUser> = {};
  for (const login of LOGINS) {
    const password = supplied[login.name] ?? randomBytes(15).toString("base64url");
    const passwordHash = await hashPassword(password);
    const existing = await prisma.user.findFirst({ where: { name: login.name } });
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } })
      : await prisma.user.create({
          data: {
            name: login.name,
            email: login.email,
            initials: login.initials,
            permissions: login.role,
            passwordHash,
          },
        });
    people[login.name] = { id: user.id, name: user.name, permissions: user.permissions };
    credentials.push(`${login.name}\t${login.email}\t${login.role}\t${password}`);
  }
  const nadia = people["Nadia Roy"]!;
  const marc = people["Marc Bouchard"]!;
  const amira = people["Amira Hassan"]!;
  const julien = people["Julien Tremblay"]!;
  const sophie = people["Sophie Gagnon"]!;

  // An invitation not yet accepted, and a member who has left.
  await inviteMember(admin, {
    name: "Olivier Martin",
    email: "olivier.martin@example.com",
    role: "REGULAR",
  });
  const leaver = await prisma.user.create({
    data: {
      name: "Karim Benali",
      email: "karim.benali@example.com",
      initials: "KB",
      permissions: "REGULAR",
      passwordHash: await hashPassword(randomBytes(15).toString("base64url")),
    },
  });
  await deactivateMember(admin, leaver.id, undefined, {
    reason: "Contract ended in October; access removed",
  });

  // Lab settings, partners, cultivars -------------------------------------------------------
  await updateLabSettings(admin, {
    licenceNumber: "LIC-DEMO-0420",
    licenceHolder: "Cannabis research laboratory (demo)",
    licenceClass: "RESEARCH",
    siteAddress: "1000 Research Way, Quebec QC (demo address)",
  });
  const laurentian = await createOrganization(admin, {
    name: "Laurentian Genetics Inc.",
    country: "CA",
    licenceNumber: "LIC-CULT-7731",
    licenceClass: "CULTIVATION",
    address: "88 Rue des Pins, Sherbrooke QC",
  });
  const qas = await createOrganization(admin, {
    name: "Quebec Analytical Services",
    country: "CA",
    licenceNumber: "LIC-LAB-6120",
    licenceClass: "ANALYTICAL_TESTING",
    address: "410 Boulevard Industriel, Levis QC",
  });
  await uploadOrganizationDocument(admin, laurentian.id, {
    label: "Cultivation licence",
    fileName: "Laurentian Genetics licence.pdf",
    bytes: await pdf("Cultivation licence LIC-CULT-7731", [
      "Holder: Laurentian Genetics Inc.",
      "Class: Cultivation (standard)",
      "Valid until: 31 December 2027",
    ]),
  });
  const cherry = await createCultivar(admin, {
    name: "Cherry Diesel",
    category: "Hybrid",
    targetThc: 22,
    targetCbd: 1,
    vegetativeDays: 28,
    floweringDays: 63,
    expectedYieldGrams: 450,
  });
  const harmony = await createCultivar(admin, {
    name: "CBD Harmony",
    category: "CBD dominant",
    targetThc: 0.8,
    targetCbd: 14,
    vegetativeDays: 35,
    floweringDays: 56,
  });

  // Locations: rooms, with limits counted in plants and in weight ----------------------------
  const motherRoom = await createLocation(marc, {
    name: "Mother Room",
    code: "MOM-1",
    capacity: 20,
    capacityMeasure: "PLANTS",
    comment: "Mother stock only; HLVd screened before entry",
  });
  const hardening = await createLocation(marc, {
    name: "Hardening Room",
    code: "HRD-1",
    comment: "Rooted cuttings harden off here before the flower rooms",
  });
  const cureVault = await createLocation(marc, {
    name: "Cure Vault",
    code: "CUR-1",
    capacity: 6000,
    capacityMeasure: "WEIGHT",
    comment: "Holds up to 6 kg of flower",
  });
  const quarantine = await createLocation(marc, {
    name: "Quarantine Room",
    code: "QRT-1",
    capacity: 1,
    comment: "One isolation bench, for a plant under investigation",
  });
  const tent = await createLocation(marc, { name: "Old Grow Tent", code: "TENT-1" });
  await retireLocation(admin, tent.id, { reason: "Replaced by the Mother Room in October" });
  const vault = await prisma.location.findFirstOrThrow({ where: { name: "Vault" } });

  const group = (kind: string, cultivarId: number, quantity: number, status?: string) => ({
    kind,
    cultivarId,
    cultivarMode: "SAME" as const,
    quantity,
    statusMode: "SAME" as const,
    status,
  });
  const unitsOf = (experimentId: number) =>
    prisma.biologicalUnit.findMany({
      where: { experimentId },
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    });
  const lastTissueSample = (unitId: number) =>
    prisma.tissueSample.findFirstOrThrow({ where: { unitId }, orderBy: { id: "desc" } });

  // Mother stock: plant groups split and merged, tissue screening, a positive result -------------
  const motherStock = await createExperiment(admin, {
    name: "Demo: Mother stock maintenance",
    startDate: daysAgo(45),
    estimatedEndDate: daysAhead(120),
    comment: "Cherry Diesel mothers kept vegetative; cuttings are taken every two weeks.",
    memberIds: [amira.id, julien.id],
    locationId: motherRoom.id,
    providerMode: "INTERNAL",
    sourceDescription: "Clones from the 2025 Cherry Diesel selection",
    unitGroups: [group("PLANTS", cherry.id, 6, "VEGETATIVE")],
  } as never);
  const mothers = await unitsOf(motherStock.id);
  await registerUnits(admin, {
    type: "PLANT",
    name: "CD-ROOTED",
    quantity: 1,
    plantCount: 12,
    experimentId: motherStock.id,
    cultivarId: cherry.id,
    locationId: motherRoom.id,
    growthStage: "VEGETATIVE",
    sourceType: "CUTTING",
    sourceDescription: "Cuttings rooted in rockwool",
    sourceParentUnitId: mothers[0]!.id,
    effectiveAt: daysAgo(20),
  } as never);
  const rooted = await prisma.biologicalUnit.findFirstOrThrow({
    where: { experimentId: motherStock.id, name: { startsWith: "CD-ROOTED" } },
  });
  const split = await splitGroup(julien, rooted.id, {
    plants: 4,
    locationId: hardening.id,
    comment: "Moved to the hardening room",
  });
  await registerUnits(admin, {
    type: "PLANT",
    name: "CD-LATE",
    quantity: 1,
    plantCount: 3,
    experimentId: motherStock.id,
    cultivarId: cherry.id,
    locationId: hardening.id,
    growthStage: "VEGETATIVE",
    sourceType: "CUTTING",
    sourceDescription: "Late cuttings from the same mothers",
    sourceParentUnitId: mothers[1]!.id,
    effectiveAt: daysAgo(10),
  } as never);
  const late = await prisma.biologicalUnit.findFirstOrThrow({
    where: { experimentId: motherStock.id, name: { startsWith: "CD-LATE" } },
  });
  await mergeGroup(julien, late.id, {
    intoUnitId: split.group.id,
    comment: "Same age and cultivar, one group in the hardening room",
  });

  await recordActivity(amira, mothers[0]!.id, {
    type: "SCOUTING",
    title: "Weekly scouting",
    details: "Undersides of leaves checked on every mother; no mites or thrips seen.",
    effectiveAt: daysAgo(6),
  });
  await recordActivity(amira, mothers[1]!.id, {
    type: "BENEFICIAL_INSECTS",
    title: "Predatory mite release",
    product: "Amblyseius swirskii",
    amount: 500,
    amountUnit: "mites",
    effectiveAt: daysAgo(5),
  });
  await recordActivity(julien, mothers[2]!.id, {
    type: "PESTICIDE",
    title: "Preventive fungicide spray",
    product: "Potassium bicarbonate fungicide (demo product)",
    pcpNumber: "DEMO-30012",
    amount: 250,
    amountUnit: "mL",
    method: "Foliar spray, lights off",
    effectiveAt: daysAgo(4),
  });
  await recordActivity(julien, mothers[3]!.id, {
    type: "PRUNING",
    title: "Lower canopy removed",
    effectiveAt: daysAgo(3),
  });
  await recordActivity(amira, mothers[4]!.id, {
    type: "ENVIRONMENT",
    title: "Room reading",
    details: "24 C, 62 % relative humidity, VPD 1.1 kPa",
    effectiveAt: daysAgo(2),
  });
  await uploadAttachment(amira, mothers[4]!.id, {
    label: "Leaf yellowing, week 3",
    category: "PHOTO",
    fileName: "mother-5-leaf.png",
    bytes: png(96, 64, (x, y) => [40 + ((x * 2) % 60), 110 + ((x + y) % 90), 40 + (y % 30)]),
  });

  // HLVd screening on tissue samples: one clear, one detected, which opens a critical deviation.
  await takeTissueSample(nadia, mothers[0]!.id, {
    purpose: "PATHOGEN",
    tissue: "LEAF",
    note: "Youngest expanded leaves, pooled from three branches",
  });
  await recordLabTest(nadia, mothers[0]!.id, {
    panel: "PATHOGENS",
    analyte: "HLVd (RT-qPCR)",
    comment: "Not detected",
    labName: "Quebec Analytical Services",
    testedAt: daysAgo(8),
    tissueSampleId: (await lastTissueSample(mothers[0]!.id)).id,
  } as never);
  await takeTissueSample(nadia, mothers[5]!.id, {
    purpose: "PATHOGEN",
    tissue: "ROOT",
    note: "Root tips, the most reliable tissue for HLVd",
  });
  await recordLabTest(nadia, mothers[5]!.id, {
    panel: "PATHOGENS",
    analyte: "HLVd (RT-qPCR)",
    value: 27.4,
    uom: "Ct",
    comment: "Detected",
    labName: "Quebec Analytical Services",
    testedAt: daysAgo(7),
    tissueSampleId: (await lastTissueSample(mothers[5]!.id)).id,
  } as never);
  await moveUnit(admin, mothers[5]!.id, { toLocationId: quarantine.id }, { requireScan: false });
  await takeTissueSample(nadia, mothers[2]!.id, { purpose: "SEX", tissue: "LEAF" });
  await recordLabTest(nadia, mothers[2]!.id, {
    panel: "GENETICS",
    analyte: "Sex (PCR marker)",
    comment: "Female",
    labName: "Quebec Analytical Services",
    testedAt: daysAgo(9),
    tissueSampleId: (await lastTissueSample(mothers[2]!.id)).id,
  } as never);

  // Seed intake from an outside supplier, with its receipt, and a retention sample.
  const intake = await createExperiment(admin, {
    name: "Demo: Cherry Diesel seed intake",
    startDate: daysAgo(12),
    memberIds: [julien.id],
    locationId: vault.id,
    providerMode: "EXTERNAL",
    providerOrganizationId: laurentian.id,
    unitGroups: [{ ...group("SEEDS", cherry.id, 2), seedsPerLot: 500 }],
    ignoreCapacityWarning: true,
  } as never);
  const seedLots = await unitsOf(intake.id);
  await takeSample(nadia, seedLots[0]!.id, {
    kind: "RETENTION",
    amount: 50,
    comment: "Kept for one year in case the lot is questioned",
  });

  // Flower in a weight-limited vault: full lab panel, holds, a release sample, waste ----------
  const flower = await createExperiment(admin, {
    name: "Demo: CBD Harmony flower lots",
    startDate: daysAgo(60),
    memberIds: [sophie.id, julien.id],
    locationId: cureVault.id,
    providerMode: "INTERNAL",
    sourceDescription: "Harvest from the summer CBD Harmony run",
    unitGroups: [{ ...group("FLOWERS", harmony.id, 4, "HARVESTED"), wetWeightGrams: 1200 }],
  } as never);
  const lots = await unitsOf(flower.id);
  for (const lot of lots) {
    await changeStage(sophie, lot.id, { toStage: "DRYING", effectiveAt: daysAgo(55) } as never);
  }
  await measureUnit(sophie, lots[0]!.id, { dryWeight: 310, effectiveAt: daysAgo(40) } as never);
  await measureUnit(sophie, lots[1]!.id, { dryWeight: 295, effectiveAt: daysAgo(40) } as never);
  await changeStage(sophie, lots[0]!.id, { toStage: "CURING", effectiveAt: daysAgo(38) } as never);
  await recordWaste(sophie, lots[0]!.id, {
    type: "TRIM",
    amount: 35,
    method: "Mixed 50:50 with soil and composted on site",
    effectiveAt: daysAgo(37),
  } as never);
  await recordWaste(sophie, lots[1]!.id, {
    type: "STEMS_LEAVES",
    amount: 22,
    method: "Ground and mixed with kitchen compost",
    effectiveAt: daysAgo(37),
  } as never);

  const panel = [
    { panel: "POTENCY", analyte: "CBD", value: 13.8, uom: "%" },
    { panel: "POTENCY", analyte: "THC", value: 0.6, uom: "%" },
    { panel: "TERPENES", analyte: "Myrcene", value: 0.42, uom: "%" },
    { panel: "MOISTURE", analyte: "Moisture", value: 11.5, uom: "%" },
    { panel: "MICROBIALS", analyte: "Total yeast and mould", value: 1200, uom: "CFU/g" },
    { panel: "HEAVY_METALS", analyte: "Lead", value: 0.04, uom: "ppm" },
    { panel: "PESTICIDES", analyte: "Multi-residue screen", comment: "None of 96 detected" },
    { panel: "MYCOTOXINS", analyte: "Total aflatoxins", value: 0.8, uom: "ug/kg" },
  ];
  for (const result of panel) {
    await recordLabTest(nadia, lots[0]!.id, {
      ...result,
      labName: "Quebec Analytical Services",
      testedAt: daysAgo(20),
    } as never);
  }
  const wrong = await recordLabTest(nadia, lots[1]!.id, {
    panel: "POTENCY",
    analyte: "CBD",
    value: 31,
    uom: "%",
    labName: "Quebec Analytical Services",
  } as never);
  await voidLabTest(nadia, wrong.testId, { reason: "Entered against the wrong lot" });
  await uploadAttachment(sophie, lots[0]!.id, {
    label: "Certificate of analysis QAS-1187",
    category: "COA",
    fileName: "COA QAS-1187.pdf",
    bytes: await pdf("Certificate of analysis QAS-1187", [
      "Sample: CBD Harmony, lot 1 (dried flower)",
      "CBD 13.8 %   THC 0.6 %   Moisture 11.5 %",
      "Total yeast and mould 1200 CFU/g   Lead 0.04 ppm",
      "Pesticides: none of 96 detected",
    ]),
  });

  await placeHold(nadia, lots[1]!.id, {
    reason: "Awaiting microbial results before release",
    kind: "HOLD",
  });
  await releaseHold(nadia, lots[1]!.id, {
    note: "Microbials within limits on the certificate of analysis",
  });
  await placeHold(nadia, lots[2]!.id, {
    reason: "Moisture above 13 %; re-dry before it goes to storage",
    kind: "HOLD",
  });

  const release = await takeSample(nadia, lots[0]!.id, {
    kind: "RELEASE",
    amount: 10,
    comment: "Sent to the lab for the release panel",
  });
  await takeSample(nadia, lots[0]!.id, { kind: "RETENTION", amount: 5 });

  // Shipments in every state ------------------------------------------------------------------
  await createShipment(admin, {
    direction: "OUTBOUND",
    organizationId: qas.id,
    status: "DELIVERED",
    shippedDate: daysAgo(18),
    deliveredDate: daysAgo(16),
    trackingNumber: "PUR-55120788",
    licenceNumber: "LIC-LAB-6120",
    items: [
      {
        unitId: release.sample.id,
        description: "Release sample, CBD Harmony lot 1",
        materialType: "FLOWER",
        weightGrams: 10,
        moisture: "DRY",
      },
    ],
  } as never);
  const inTransit = await prisma.shipment.findFirst({ where: { trackingNumber: "CP-77120931" } });
  if (inTransit) {
    await updateShipment(admin, inTransit.id, {
      status: "DELIVERED",
      deliveredDate: daysAgo(2),
    } as never);
  }
  await createShipment(admin, {
    direction: "OUTBOUND",
    organizationId: laurentian.id,
    status: "DRAFT",
    comment: "Waiting for the buyer's import permit",
    items: [
      {
        unitId: seedLots[1]!.id,
        description: "Cherry Diesel seeds",
        materialType: "SEED",
        unitCount: 200,
      },
    ],
  } as never);
  const duplicate = await createShipment(admin, {
    direction: "OUTBOUND",
    organizationId: qas.id,
    status: "DRAFT",
    items: [
      {
        description: "Trim for a solvent test",
        materialType: "TRIM",
        weightGrams: 50,
        moisture: "DRY",
      },
    ],
  } as never);
  await voidShipment(admin, duplicate.id, {
    reason: "Created twice; the other draft is the one being sent",
  });

  // Procedures: versions, a document, signatures ----------------------------------------------
  const sopBody = (steps: string[]) => steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
  const sop = async (code: string, title: string, steps: string[]) => {
    await createSop(nadia, { code, title, body: sopBody(steps) });
    return prisma.sop.findUniqueOrThrow({ where: { code } });
  };
  const harvest = await sop("SOP-001", "Harvest, wet weight and labelling", [
    "Cut each plant at the base and hang it whole.",
    "Weigh the wet plant material before it leaves the room.",
    "Record the wet weight on the unit and print its label.",
  ]);
  await updateSop(nadia, harvest.id, { action: "approve" });
  await updateSop(amira, harvest.id, { action: "sign" });
  await updateSop(nadia, harvest.id, {
    action: "draft",
    body: sopBody([
      "Check the scale with the 500 g reference weight; stop if it is off by more than 1 g.",
      "Cut each plant at the base and hang it whole.",
      "Weigh the wet plant material before it leaves the room.",
      "Record the wet weight on the unit and print its label.",
    ]),
    changeNote: "Scale check added before each weighing session",
  });
  await attachSopFile(nadia, harvest.id, {
    fileName: "SOP-001 Harvest v2.pdf",
    bytes: await pdf("SOP-001 Harvest, wet weight and labelling (v2)", [
      "1. Check the scale with the 500 g reference weight.",
      "2. Cut each plant at the base and hang it whole.",
      "3. Weigh the wet plant material before it leaves the room.",
      "4. Record the wet weight on the unit and print its label.",
    ]),
  });
  await updateSop(nadia, harvest.id, { action: "approve" });
  await updateSop(julien, harvest.id, { action: "sign" });
  await updateSop(marc, harvest.id, { action: "sign" });

  const destruction = await sop("SOP-014", "Destruction of cannabis material", [
    "Only an administrator records a destruction, with its reason.",
    "Render the material unusable: grind it and mix it 50:50 with soil.",
    "Record the weight destroyed the same day.",
  ]);
  await attachSopFile(nadia, destruction.id, {
    fileName: "SOP-014 Destruction.pdf",
    bytes: await pdf("SOP-014 Destruction of cannabis material", [
      "1. Only an administrator records a destruction, with its reason.",
      "2. Grind the material and mix it 50:50 with soil.",
      "3. Record the weight destroyed the same day.",
    ]),
  });
  await updateSop(nadia, destruction.id, { action: "approve" });
  await updateSop(admin, destruction.id, { action: "sign" });
  await updateSop(sophie, destruction.id, { action: "sign" });

  const culture = await sop("SOP-007", "Tissue culture subculturing", [
    "Work in the laminar flow hood after 15 minutes of air flow.",
    "Flame the tools between every explant.",
    "Label each new vessel with its parent culture.",
  ]);
  await updateSop(nadia, culture.id, { action: "approve" });
  await sop("SOP-020", "Integrated pest management scouting", [
    "Scout every room once a week, row by row.",
    "Check the undersides of leaves with a hand lens.",
    "Record what is found as a scouting activity on the units.",
  ]);

  // Deviations and corrective actions -----------------------------------------------------------
  const capaIds = async (incidentId: number) =>
    (await prisma.capaAction.findMany({ where: { incidentId }, orderBy: { id: "asc" } })).map(
      (capa) => capa.id
    );
  const screening = await prisma.experiment.findFirst({
    where: { name: "Demo: Mixed cultivar screening" },
  });

  const scale = await openIncident(nadia, {
    title: "Harvest weighed on an uncalibrated scale",
    description:
      "The harvest scale read 4 g high against the reference weight; ten lots were weighed on it.",
    severity: "MAJOR",
    experimentId: screening?.id,
  });
  await updateIncident(nadia, scale.incidentId, { status: "INVESTIGATING", sopId: harvest.id });
  await runCapaCommand(nadia, scale.incidentId, {
    action: "add",
    kind: "CORRECTIVE",
    description: "Re-weigh the affected lots on the calibrated scale",
    ownerId: julien.id,
    dueDate: daysAgo(2),
  });
  await runCapaCommand(nadia, scale.incidentId, {
    action: "add",
    kind: "PREVENTIVE",
    description: "Add a reference-weight check to SOP-001",
    ownerId: nadia.id,
    dueDate: daysAhead(10),
  });
  const [reweigh] = await capaIds(scale.incidentId);
  await runCapaCommand(julien, scale.incidentId, {
    action: "complete",
    capaId: reweigh!,
    note: "All ten lots re-weighed; differences under 0.5 g",
  });

  const lateRecord = await openIncident(nadia, {
    title: "Destruction recorded two days late",
    description: "A culture destroyed on Monday was only recorded on Wednesday.",
    severity: "MINOR",
  });
  await updateIncident(nadia, lateRecord.incidentId, { sopId: destruction.id });
  await runCapaCommand(nadia, lateRecord.incidentId, {
    action: "add",
    kind: "CORRECTIVE",
    description: "Retrain the team on SOP-014",
    ownerId: nadia.id,
    dueDate: daysAgo(6),
  });
  const [retrain] = await capaIds(lateRecord.incidentId);
  await runCapaCommand(nadia, lateRecord.incidentId, {
    action: "complete",
    capaId: retrain!,
    note: "Training given to all members on 28 October",
  });
  await runCapaCommand(admin, lateRecord.incidentId, {
    action: "verify",
    capaId: retrain!,
    note: "No late destruction records in the two weeks since",
  });
  await updateIncident(nadia, lateRecord.incidentId, {
    status: "CLOSED",
    resolution: "Team retrained; destructions are now recorded the same day.",
  });

  // A critical result on a unit places a hold on it automatically.
  const hlvd = await openIncident(nadia, {
    title: "HLVd detected in a mother plant",
    description: `Root tissue from ${mothers[5]!.name} tested positive for hop latent viroid (Ct 27.4).`,
    severity: "CRITICAL",
    unitId: mothers[5]!.id,
    experimentId: motherStock.id,
  });
  await updateIncident(nadia, hlvd.incidentId, { status: "INVESTIGATING" });
  await runCapaCommand(nadia, hlvd.incidentId, {
    action: "add",
    kind: "CORRECTIVE",
    description: "Destroy the infected mother and sanitise its bench",
    ownerId: admin.id,
    dueDate: daysAhead(2),
  });
  await runCapaCommand(nadia, hlvd.incidentId, {
    action: "add",
    kind: "PREVENTIVE",
    description: "Screen every new mother for HLVd before it enters the Mother Room",
    ownerId: nadia.id,
    dueDate: daysAhead(14),
  });

  await openIncident(nadia, {
    title: "Humidity above 70 % in the Drying Room overnight",
    description: "The dehumidifier tripped at 02:00; humidity reached 74 % before 07:00.",
    severity: "MINOR",
  });
  const twice = await openIncident(nadia, {
    title: "Temperature alarm in Flower Room 1",
    description: "Opened twice by mistake.",
    severity: "MINOR",
  });
  await voidIncident(nadia, twice.incidentId, { reason: "Duplicate of another record" });

  // A destruction under the destruction procedure.
  const cultures = await prisma.biologicalUnit.findMany({
    where: { type: "CULTURE", currentState: { kind: { notIn: ["DESTROYED", "SHIPPED"] } } },
    orderBy: { id: "asc" },
    take: 1,
  });
  if (cultures[0]) {
    await destroyUnit(admin, cultures[0].id, {
      reason: "Bacterial contamination in the vessel; destroyed per SOP-014",
    } as never);
  }

  // Tasks: overdue, due today, upcoming, unassigned, done, cancelled, moved -------------------
  const exp1 = await prisma.experiment.findFirst({ where: { name: "Terpene profile stability" } });
  const task = async (input: Record<string, unknown>) => createTask(admin, input as never);
  await task({
    title: "Scout Flower Room 1 for powdery mildew",
    dueDate: daysAgo(3),
    experimentId: exp1?.id,
    assigneeId: amira.id,
  });
  await task({
    title: "Weigh the CBD Harmony lots after drying",
    dueDate: daysAgo(0),
    experimentId: flower.id,
    assigneeId: sophie.id,
  });
  await task({
    title: "Re-dry lot 3 and test its moisture again",
    dueDate: daysAhead(1),
    unitId: lots[2]!.id,
    assigneeId: sophie.id,
  });
  await task({
    title: "Send the release samples to Quebec Analytical Services",
    dueDate: daysAhead(5),
    assigneeId: marc.id,
  });
  await task({
    title: "Screen the mothers for HLVd again",
    details: "Root tips from every mother, after the infected plant is gone.",
    dueDate: daysAhead(14),
    experimentId: motherStock.id,
    assigneeId: julien.id,
  });
  await task({ title: "Clean and sanitise the Drying Room", dueDate: daysAhead(2) });
  const calibrate = await task({
    title: "Calibrate the harvest scale",
    dueDate: daysAgo(4),
    assigneeId: marc.id,
  });
  await updateTask(marc, calibrate.id, { action: "complete" });
  const lights = await task({ title: "Order replacement grow lights", dueDate: daysAhead(20) });
  await updateTask(admin, lights.id, { action: "cancel", reason: "Budget moved to next term" });
  const moved = await task({
    title: "Inventory count of the Vault",
    dueDate: daysAgo(1),
    assigneeId: marc.id,
  });
  await updateTask(admin, moved.id, { action: "reschedule", dueDate: daysAhead(3) });

  // Documents on an experiment, saved list views ----------------------------------------------
  if (exp1) {
    await uploadExperimentDocument(admin, exp1.id, {
      label: "Study protocol v1",
      fileName: "Terpene stability protocol.pdf",
      bytes: await pdf("Terpene profile stability: study protocol", [
        "Aim: follow the terpene profile of Northern Lights over three generations.",
        "Sampling: one flower sample per plant at harvest and after curing.",
        "Analysis: terpene panel by GC-MS at an accredited laboratory.",
      ]),
    });
  }
  await saveView(admin, { list: "units", name: "On hold", query: "status=hold" });
  await saveView(admin, {
    list: "units",
    name: "Flower lots by room",
    query: "type=FLOWER&group=location",
  });
  await saveView(admin, {
    list: "experiments",
    name: "Running, as a table",
    query: "status=running&view=table",
  });

  const credentialsFile = process.env.SEED_CREDENTIALS_FILE ?? ".local/scenario-credentials.txt";
  mkdirSync(".local", { recursive: true });
  writeFileSync(credentialsFile, `name\temail\trole\tpassword\n${credentials.join("\n")}\n`);
  console.log(`Demo login passwords were written to ${credentialsFile} (git-ignored).`);
}

/**
 * A recall from end to end. One Blue Dream mother, sprayed by mistake with a fungicide not allowed
 * on cannabis, gives two generations of cuttings; four of them are harvested into flower lots, two
 * of which send release samples to the lab. Lots go to a processor and a medical seller before the
 * result comes back over the limit. The result opens a critical deviation that holds its lot, and
 * quality assurance holds the rest of the line. Trace any unit of it on the Recall page.
 */
async function addRecallChain(admin: SessionUser) {
  const person = async (name: string): Promise<SessionUser> => {
    const user = await prisma.user.findFirstOrThrow({ where: { name } });
    return { id: user.id, name: user.name, permissions: user.permissions };
  };
  const [nadia, marc, amira] = await Promise.all([
    person("Nadia Roy"),
    person("Marc Bouchard"),
    person("Amira Hassan"),
  ]);
  const place = (name: string) => prisma.location.findFirstOrThrow({ where: { name } });
  const [motherRoom, flowerRoom, dryingRoom, vault] = await Promise.all([
    place("Mother Room"),
    place("Flower Room 1"),
    place("Drying Room"),
    place("Vault"),
  ]);
  const dream = await prisma.cultivar.findFirstOrThrow({ where: { name: "Blue Dream" } });
  const qas = await prisma.organization.findFirstOrThrow({
    where: { name: "Quebec Analytical Services" },
  });
  const nordic = await createOrganization(admin, {
    name: "Nordic Medical Cannabis Ltd.",
    country: "CA",
    licenceNumber: "LIC-MED-4410",
    licenceClass: "MEDICAL_SALES",
    address: "2200 Rue Sainte-Catherine, Montreal QC",
  });
  const extraction = await createOrganization(admin, {
    name: "Saint-Laurent Extraction Inc.",
    country: "CA",
    licenceNumber: "LIC-PROC-3307",
    licenceClass: "PROCESSING",
    address: "75 Chemin du Fleuve, Trois-Rivieres QC",
  });

  const run = await createExperiment(admin, {
    name: RECALL_RUN,
    startDate: daysAgo(160),
    comment: "One mother, two generations of cuttings, four flower lots sold to two customers.",
    memberIds: [amira.id],
    locationId: motherRoom.id,
    providerMode: "INTERNAL",
    sourceDescription: "Blue Dream mother kept from the 2025 selection",
  } as never);
  const register = async (input: Record<string, unknown>) => {
    await registerUnits(admin, {
      quantity: 1,
      experimentId: run.id,
      cultivarId: dream.id,
      ...input,
    } as never);
    return prisma.biologicalUnit.findMany({
      where: { experimentId: run.id, name: { startsWith: input.name as string } },
      orderBy: { id: "asc" },
    });
  };
  const stage = (unitId: number, toStage: string, effectiveAt: string) =>
    changeStage(admin, unitId, { toStage, effectiveAt } as never);

  const [mother] = await register({
    type: "PLANT",
    name: "BD-MOTHER",
    locationId: motherRoom.id,
    growthStage: "VEGETATIVE",
    sourceType: "INTERNAL",
    sourceDescription: "Blue Dream mother kept from the 2025 selection",
    effectiveAt: daysAgo(160),
  });
  await recordActivity(amira, mother!.id, {
    type: "PESTICIDE",
    title: "Fungicide spray against powdery mildew",
    details: "Product taken from the general store; not on the lab's approved list.",
    product: "Myclobutanil fungicide (demo product, not approved for cannabis)",
    pcpNumber: "DEMO-22931",
    amount: 150,
    amountUnit: "mL",
    method: "Foliar spray",
    effectiveAt: daysAgo(150),
  });

  // Two generations of cuttings, then flowering and harvest.
  const cuttings = await register({
    type: "PLANT",
    name: "BD-CUT",
    quantity: 3,
    locationId: flowerRoom.id,
    growthStage: "VEGETATIVE",
    sourceType: "CUTTING",
    sourceDescription: "Cuttings from BD-MOTHER",
    sourceParentUnitId: mother!.id,
    effectiveAt: daysAgo(140),
  });
  const second = await register({
    type: "PLANT",
    name: "BD-GEN2",
    quantity: 2,
    locationId: flowerRoom.id,
    growthStage: "VEGETATIVE",
    sourceType: "CUTTING",
    sourceDescription: `Cuttings from ${cuttings[0]!.name}`,
    sourceParentUnitId: cuttings[0]!.id,
    effectiveAt: daysAgo(120),
  });
  for (const plant of cuttings.slice(1)) {
    await stage(plant.id, "FLOWERING", daysAgo(110));
    await stage(plant.id, "HARVESTED", daysAgo(55));
    await measureUnit(admin, plant.id, { humidWeight: 1150, effectiveAt: daysAgo(55) } as never);
  }
  for (const plant of second) {
    await stage(plant.id, "FLOWERING", daysAgo(95));
    await stage(plant.id, "HARVESTED", daysAgo(45));
    await measureUnit(admin, plant.id, { humidWeight: 980, effectiveAt: daysAgo(45) } as never);
  }
  await recordWaste(admin, cuttings[1]!.id, {
    type: "STEMS_LEAVES",
    amount: 300,
    method: "Ground and mixed 50:50 with soil",
    effectiveAt: daysAgo(54),
  } as never);

  // Four flower lots, each from one harvested plant, dried, cured and stored.
  const lot = async (
    name: string,
    parent: { id: number; name: string },
    day: number,
    wet: number
  ) =>
    (
      await register({
        type: "FLOWER",
        name,
        locationId: dryingRoom.id,
        growthStage: "DRYING",
        humidWeight: wet,
        sourceType: "HARVEST",
        sourceDescription: `Harvest of ${parent.name}`,
        sourceParentUnitId: parent.id,
        effectiveAt: daysAgo(day),
      })
    )[0]!;
  const lotA = await lot("BD-LOT-A", cuttings[1]!, 54, 820);
  const lotB = await lot("BD-LOT-B", cuttings[2]!, 54, 790);
  const lotC = await lot("BD-LOT-C", second[0]!, 44, 700);
  const lotD = await lot("BD-LOT-D", second[1]!, 44, 680);
  for (const [unit, dry, day] of [
    [lotA, 190, 40],
    [lotB, 182, 40],
    [lotC, 165, 32],
    [lotD, 158, 32],
  ] as const) {
    await measureUnit(admin, unit.id, { dryWeight: dry, effectiveAt: daysAgo(day) } as never);
    await stage(unit.id, "CURING", daysAgo(day - 1));
    await stage(unit.id, "STORAGE", daysAgo(day - 15));
  }
  await moveUnit(admin, lotD.id, { toLocationId: vault.id }, { requireScan: false });

  // Release samples to the lab; lots to a processor and a medical seller.
  const sampleA = await takeSample(nadia, lotA.id, { kind: "RELEASE", amount: 10 });
  const sampleB = await takeSample(nadia, lotB.id, { kind: "RELEASE", amount: 10 });
  const ship = (input: Record<string, unknown>) =>
    createShipment(admin, { direction: "OUTBOUND", ...input } as never);
  const flowerLine = (unitId: number, description: string, weightGrams: number) => ({
    unitId,
    description,
    materialType: "FLOWER",
    weightGrams,
    moisture: "DRY",
  });
  await ship({
    organizationId: qas.id,
    status: "DELIVERED",
    shippedDate: daysAgo(9),
    deliveredDate: daysAgo(8),
    trackingNumber: "PUR-55120911",
    items: [
      flowerLine(sampleA.sample.id, "Release sample, BD-LOT-A", 10),
      flowerLine(sampleB.sample.id, "Release sample, BD-LOT-B", 10),
    ],
  });
  await ship({
    organizationId: extraction.id,
    status: "DELIVERED",
    shippedDate: daysAgo(10),
    deliveredDate: daysAgo(8),
    trackingNumber: "CP-88301245",
    licenceNumber: "LIC-PROC-3307",
    items: [flowerLine(lotB.id, "Blue Dream dried flower for extraction", 172)],
  });
  await ship({
    organizationId: nordic.id,
    status: "DELIVERED",
    shippedDate: daysAgo(7),
    deliveredDate: daysAgo(6),
    trackingNumber: "CP-88301390",
    licenceNumber: "LIC-MED-4410",
    items: [flowerLine(lotA.id, "Blue Dream dried flower", 100)],
  });
  await ship({
    organizationId: nordic.id,
    status: "IN_TRANSIT",
    shippedDate: daysAgo(1),
    trackingNumber: "CP-88301477",
    licenceNumber: "LIC-MED-4410",
    items: [flowerLine(lotC.id, "Blue Dream dried flower", 80)],
  });

  // The result comes back over the limit: a critical deviation holds the lot.
  await recordLabTest(nadia, lotA.id, {
    panel: "PESTICIDES",
    analyte: "Myclobutanil",
    value: 0.08,
    uom: "ppm",
    comment: "Release sample from this lot; the limit is 0.02 ppm",
    labName: "Quebec Analytical Services",
    testedAt: daysAgo(3),
  } as never);
  const recall = await openIncident(nadia, {
    title: "Myclobutanil above the limit in Blue Dream lot A",
    description:
      "The release sample from BD-LOT-A had 0.08 ppm myclobutanil (limit 0.02 ppm). BD-MOTHER was " +
      "sprayed with a myclobutanil fungicide 150 days ago, so every unit from that mother is suspect.",
    severity: "CRITICAL",
    unitId: lotA.id,
    experimentId: run.id,
  });
  await updateIncident(nadia, recall.incidentId, { status: "INVESTIGATING" });
  for (const unit of [mother!, cuttings[0]!, lotC, lotD]) {
    await placeHold(nadia, unit.id, {
      reason:
        "Same mother plant as BD-LOT-A, which tested positive for myclobutanil. Held until the recall investigation ends.",
      kind: "HOLD",
    });
  }
  const action = (input: Record<string, unknown>) =>
    runCapaCommand(nadia, recall.incidentId, { action: "add", ...input } as never);
  await action({
    kind: "CORRECTIVE",
    description: "Hold every unit still in the lab that comes from BD-MOTHER",
    ownerId: nadia.id,
    dueDate: daysAgo(0),
  });
  await action({
    kind: "CORRECTIVE",
    description: "Ask Nordic Medical Cannabis and Saint-Laurent Extraction to quarantine the lots",
    ownerId: admin.id,
    dueDate: daysAhead(1),
  });
  await action({
    kind: "PREVENTIVE",
    description: "Remove myclobutanil products from the store; keep only approved products",
    ownerId: marc.id,
    dueDate: daysAhead(7),
  });
  const [holdAll] = await prisma.capaAction.findMany({
    where: { incidentId: recall.incidentId },
    orderBy: { id: "asc" },
  });
  await runCapaCommand(nadia, recall.incidentId, {
    action: "complete",
    capaId: holdAll!.id,
    note: "Held BD-MOTHER, BD-CUT-1, BD-LOT-C and BD-LOT-D; BD-LOT-A is held by this deviation",
  });
  await createTask(admin, {
    title: "Recall: confirm both customers have quarantined the Blue Dream lots",
    dueDate: daysAhead(1),
    assigneeId: nadia.id,
  });
  console.log("Added the Blue Dream recall chain.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
