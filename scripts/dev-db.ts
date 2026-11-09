import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

/**
 * Local PostgreSQL 16 for development without Docker. The cluster lives in
 * `.local/pgdata` (git-ignored) and survives restarts. Use `docker compose up -d postgres`
 * instead if you have Docker; both expose the same URL (see .env.example).
 *
 *   npm run db:start     # keep this terminal open
 */
const PORT = Number(process.env.PGPORT ?? 5432);
// Not ".local/pgdata": that cluster of an earlier iteration used the Windows default encoding.
const DATA_DIR = path.resolve(".local/pg16");
const DATABASE = "accession_book";
const USER = "accession";
const PASSWORD = "accession-dev-only"; // local development only

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // Always UTF-8: regulated records contain accented characters and symbols, and the
    // Windows default (WIN1252) cannot store them. Production (RDS) defaults to UTF-8.
    initdbFlags: ["--encoding=UTF8", "--locale=en-US"],
    onLog: () => {},
  });

  const fresh = !fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase(DATABASE);

  console.log(
    `PostgreSQL ready: postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}  (Ctrl+C to stop)`
  );

  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
