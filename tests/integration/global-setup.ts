import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

/**
 * Hermetic database for integration tests. In CI, point TEST_DATABASE_URL at the service
 * container; locally a throwaway PostgreSQL 16 starts on a random port. Either way a fresh
 * database is created, the real migrations are applied, and everything is dropped afterwards.
 */
let embedded: EmbeddedPostgres | undefined;
let dataDir: string | undefined;
let adminUrl = "";
let databaseName = "";

export async function setup() {
  if (process.env.TEST_DATABASE_URL) {
    adminUrl = process.env.TEST_DATABASE_URL;
  } else {
    dataDir = mkdtempSync(path.join(tmpdir(), "accession-pg-"));
    const port = 54000 + Math.floor(Math.random() * 900);
    embedded = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "test",
      password: "test",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=en-US"],
      onLog: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    adminUrl = `postgresql://test:test@localhost:${port}/postgres`;
  }

  databaseName = `accession_test_${Date.now()}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.toString();

  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}

export async function teardown() {
  if (adminUrl && databaseName) {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
  await embedded?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
