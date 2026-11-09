/**
 * A small, realistic, SYNTHETIC legacy Cannabase dump for tests. The real export is not available,
 * so this mirrors the INSERT format the parser expects: MySQL-style statements, backtick-quoted
 * identifiers, backslash-escaped quotes, NULLs, wall-clock timestamps without a zone, and one table
 * split over several INSERT statements.
 *
 * The cast (all names invented):
 *
 *   OA1  "Mother stock & cuttings"   mother OA1-001 (Northern Lights) cut three times
 *          OA1-002  cutting, moved + flowered, then destroyed (reason recorded)
 *          OA1-003  cutting, flowered, still active
 *          OA1-004  cutting, destroyed with no reason in the legacy record
 *   OA2  sub-experiment of OA1, source unit OA1-001
 *          OA2-001  plant cut from OA1-003; OA2-F01  its harvest: weights, moves, stage changes,
 *          then shipped to a laboratory
 *   KE1  seed receiving
 *          KE1-001  seed lot received from a partner (500 seeds, later counted at 480)
 *          KE1-002  plant sown from that lot, in quarantine
 *          KE1-003  tissue culture
 *   OA10 experiment with the highest OA number (seeds the code counter) and an un-linked plant
 *
 * Legacy ids are deliberately not 1..n in the state table so nothing can lean on them.
 */
export type Literal = string | number | null;
export type FixtureTable = { columns: string[]; rows: Literal[][]; statements?: number };
export type CannabaseFixture = Record<string, FixtureTable>;

/** Counts a test can assert against; kept next to the data so they cannot drift apart. */
export const SYNTHETIC_COUNTS = {
  users: 7,
  pendingInvites: 6,
  deactivatedUsers: 1,
  cultivars: 4,
  locations: 5,
  organizations: 3,
  experiments: 4,
  experimentMembers: 6,
  units: 10,
  states: 20,
  activeHolds: 1,
} as const;

const at = (day: string, time = "09:00:00") => `${day} ${time}`;

export function buildCannabaseFixture(): CannabaseFixture {
  return {
    Users: {
      columns: ["id", "name", "password", "permissions", "email", "active"],
      rows: [
        [1, "Helene", "$2b$10$legacyhashneverimported1", "ADMIN", "helene@lab.example", 1],
        [2, "Kimy-Li", "$2b$10$legacyhashneverimported2", "REGULAR", "kimy@lab.example", 1],
        [3, "Kevin", "$2b$10$legacyhashneverimported3", "REGULAR", "kevin@lab.example", 1],
        [4, "Justine", "$2b$10$legacyhashneverimported4", "admin", "justine@lab.example", 1],
        [5, "Julien Roy", "$2b$10$legacyhashneverimported5", "REGULAR", "julien@lab.example", 1],
        [6, "Rita Retired", "$2b$10$legacyhashneverimported6", "REGULAR", null, 0],
        [7, "Odd Perm", "$2b$10$legacyhashneverimported7", "SUPERVISOR", "odd@lab.example", 1],
      ],
    },
    Cultivars: {
      columns: ["id", "name", "comment"],
      rows: [
        [1, "Northern Lights", "Indica-dominant reference line"],
        [2, "OG Kush", null],
        [3, "Blue Dream", "Sativa-leaning"],
        [4, "Chemdawg &#39;91", "Phenotype selected in 2019"],
      ],
    },
    Locations: {
      columns: ["id", "name", "address", "comment", "active"],
      rows: [
        [1, "Room 1 - Vegetative", "Building A", null, 1],
        [2, "Room 2 - Flower", "Building A", "Dehumidified", 1],
        [3, "Drying Room", "Building B", null, 1],
        [4, "Vault", "Building B", "Controlled access", 1],
        [5, "Old Closet", null, "Decommissioned", 0],
      ],
    },
    Organizations: {
      columns: ["id", "name", "address", "country", "comment"],
      rows: [
        [1, "Green Seeds Ltd.", "12 Maple Rd, Guelph ON", "Canada", "Licensed seed vendor"],
        [2, "Prairie Genetics Co-op", null, "Canada", null],
        [3, "North Lab Analytics (O'Neil & Sons)", "9 Lab St", "Canada", "Testing laboratory"],
      ],
    },
    Experiments: {
      columns: [
        "id",
        "ecode",
        "name",
        "startDate",
        "endDate",
        "comment",
        "parentExperimentId",
        "sourceUnitId",
      ],
      rows: [
        [
          1,
          "OA1",
          "Mother stock &amp; cuttings",
          at("2025-01-10"),
          null,
          "Team: Kimy-Li, Kevin Dragan",
          null,
          null,
        ],
        [
          2,
          "OA2",
          "Flowering trial",
          at("2025-03-01"),
          at("2025-09-01"),
          "Led by Helene; with Julien",
          1,
          1,
        ],
        [3, "KE1", "Seed receiving", at("2025-02-01"), null, "Justine, Kevin Dragan", null, null],
        [4, "OA10", "Late addition", at("2025-08-01"), null, null, null, null],
      ],
    },
    BiologicalUnits: {
      columns: [
        "id",
        "name",
        "cultivarId",
        "sex",
        "type",
        "experimentId",
        "comment",
        "holdStatus",
        "holdReason",
        "holdAt",
      ],
      rows: [
        [1, "OA1-001", 1, "F", "PLANT", 1, "Mother plant", null, null, null],
        [2, "OA1-002", 1, "F", "PLANT", 1, null, null, null, null],
        [3, "OA1-003", 1, "F", "PLANT", 1, null, null, null, null],
        [4, "OA1-004", 1, "F", "PLANT", 1, null, null, null, null],
        [5, "OA2-001", 1, "F", "PLANT", 2, null, null, null, null],
        [6, "OA2-F01", 1, null, "FLOWER", 2, "First harvest", null, null, null],
        [7, "KE1-001", 2, null, "SEEDLOT", 3, "Sealed bag", null, null, null],
        [
          8,
          "KE1-002",
          2,
          "U",
          "PLANT",
          3,
          null,
          "QUARANTINE",
          "Suspected spider mites",
          at("2025-04-20", "10:15:00"),
        ],
        [9, "KE1-003", 3, null, "CULTURE", 3, "Tissue culture jar", null, null, null],
        [10, "OA10-001", 1, "F", "PLANT", 4, "Brought in from outside", null, null, null],
      ],
    },
    Plants: {
      columns: ["id", "humidWeight", "originName"],
      rows: [
        [8, null, null],
        [10, 120, "Roy's clone bank (unverified)"],
      ],
    },
    // Two INSERT statements for one table, as a real dump produces.
    States: {
      statements: 2,
      columns: ["id", "type", "date", "unitId"],
      rows: [
        [101, "PLANT", at("2025-01-12"), 1],
        [201, "PLANT", at("2025-02-01"), 2],
        [202, "PLANT", at("2025-03-01"), 2],
        [203, "PLANT", at("2025-05-10", "14:00:00"), 2],
        [301, "PLANT", at("2025-02-01"), 3],
        [302, "PLANT", at("2025-03-15"), 3],
        [401, "PLANT", at("2025-02-01"), 4],
        [402, "PLANT", at("2025-02-20", "11:00:00"), 4],
        [501, "PLANT", at("2025-03-20"), 5],
        [601, "FLOWER", at("2025-06-01"), 6],
        [602, "FLOWER", at("2025-06-10"), 6],
        [603, "FLOWER", at("2025-06-20"), 6],
        [604, "FLOWER", at("2025-07-15", "10:00:00"), 6],
        [701, "SEEDLOT", at("2025-02-05", "08:30:00"), 7],
        [702, "SEEDLOT", at("2025-04-01"), 7],
        [801, "PLANT", at("2025-04-05"), 8],
        [901, "CULTURE", at("2025-02-10"), 9],
        [1001, "PLANT", at("2025-08-01"), 10],
      ],
    },
    PlantStates: {
      columns: ["id", "growthStage"],
      rows: [
        [101, "VEGETATIVE"],
        [201, "VEGETATIVE"],
        [202, "FLOWERING"],
        [203, "FLOWERING"],
        [301, "VEGETATIVE"],
        [302, "FLOWERING"],
        [401, "VEGETATIVE"],
        [402, "VEGETATIVE"],
        [501, "FLOWERING"],
        [601, "DRYING"],
        [602, "DRYING"],
        [603, "CURING"],
        [604, "CURING"],
        [801, "VEGETATIVE"],
        [1001, "FLOWERING"],
      ],
    },
    FlowerStates: {
      columns: ["id", "humidWeight", "dryWeight"],
      rows: [
        [601, 450.5, null],
        [602, 450.5, 98.25],
        [603, 450.5, 98.25],
        [604, 450.5, 98.25],
      ],
    },
    SeedLotStates: {
      columns: ["id", "seedCount"],
      rows: [
        [701, 500],
        [702, 480],
      ],
    },
    Manipulations: {
      columns: ["parentId", "childId", "comment"],
      rows: [
        [101, 201, "Cutting 1"],
        [101, 301, "Cutting 2"],
        [101, 401, "Cutting 3"],
        [302, 501, "Moved into the flowering trial"],
        [501, 601, "Harvest"],
        [702, 801, "Germinated"],
      ],
    },
    ReceivedFrom: {
      columns: ["stateId", "organizationId", "date", "comment"],
      rows: [[701, 1, at("2025-02-05", "08:30:00"), "Lot SC-2291 received sealed"]],
    },
    SentTo: {
      columns: ["stateId", "organizationId", "date", "comment"],
      rows: [[604, 3, at("2025-07-15", "10:00:00"), "Sent for potency testing"]],
    },
    Destroyed: {
      columns: ["stateId", "date", "comment"],
      rows: [
        [203, at("2025-05-10", "14:00:00"), "Powdery mildew; whole tray removed"],
        [402, at("2025-02-20", "11:00:00"), null],
      ],
    },
    Stores: {
      columns: ["stateId", "locationId"],
      rows: [
        [101, 1],
        [201, 1],
        [202, 2],
        [203, 2],
        [301, 1],
        [302, 1],
        [401, 1],
        [402, 1],
        [501, 2],
        [601, 3],
        [602, 3],
        [603, 4],
        [604, 4],
        [701, 4],
        [702, 4],
        [801, 1],
        [901, 1],
        [1001, 2],
      ],
    },
    StateRecords: {
      columns: ["stateId", "userId", "saveDate"],
      rows: [
        [101, 2, at("2025-01-12", "09:05:00")],
        [202, 3, at("2025-03-01", "09:10:00")],
        [203, 3, at("2025-05-10", "14:05:00")],
        [601, 1, at("2025-06-01", "09:20:00")],
      ],
    },
  };
}

function literal(value: Literal): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `'${escaped}'`;
}

/** Renders the fixture as a mysqldump-style script. */
export function renderCannabaseDump(fixture: CannabaseFixture): string {
  const lines: string[] = [
    "-- Synthetic Cannabase export (test fixture)",
    "SET NAMES utf8mb4;",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "",
  ];
  for (const [table, { columns, rows, statements = 1 }] of Object.entries(fixture)) {
    if (rows.length === 0) continue;
    const size = Math.ceil(rows.length / statements);
    for (let start = 0; start < rows.length; start += size) {
      const chunk = rows.slice(start, start + size);
      lines.push(`LOCK TABLES \`${table}\` WRITE;`);
      lines.push(
        `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES`,
        chunk.map((row) => `(${row.map(literal).join(",")})`).join(",\n") + ";",
        "UNLOCK TABLES;",
        ""
      );
    }
  }
  return lines.join("\n");
}

export function syntheticCannabaseDump(): string {
  return renderCannabaseDump(buildCannabaseFixture());
}
