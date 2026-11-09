import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import "dotenv/config";
import { Client } from "pg";

/**
 * The server the end-to-end tests run against, on its own database so test runs never write into
 * the development data (and never depend on what is in it). Each run starts from a fresh database:
 * migrations, one administrator and the demo laboratory. Playwright starts this script as its
 * `webServer` locally (CI provides its own database and server).
 *
 *   npx tsx scripts/e2e-server.ts 3100
 *
 * The database is `accession_book_e2e` on the same PostgreSQL as DATABASE_URL, or E2E_DATABASE_URL.
 * The administrator's password is written to .local/e2e-admin-password.txt for the test helpers.
 * The Next.js build lives in .next-e2e so it can run next to `npm run dev`.
 */
const port = process.argv[2] ?? "3100";
const DATABASE = "accession_book_e2e";

function e2eDatabaseUrl(): URL {
  if (process.env.E2E_DATABASE_URL) return new URL(process.env.E2E_DATABASE_URL);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example)");
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${DATABASE}`;
  return url;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

async function recreateDatabase(url: URL) {
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.endsWith("_e2e")) {
    throw new Error(`Refusing to reset "${name}": the e2e database name must end in _e2e`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
  await client.end();
}

async function main() {
  const url = e2eDatabaseUrl();
  // The browser tests cover every module, including the ones a lab may switch off.
  const env = { ...process.env, DATABASE_URL: url.toString(), ENABLE_SOPS: "true" };

  console.log(`[e2e] fresh database ${url.pathname.slice(1)}`);
  await recreateDatabase(url);
  run("npx", ["prisma", "migrate", "deploy"], env);

  const password = randomBytes(18).toString("base64url");
  run(
    "npx",
    [
      "tsx",
      "--conditions=react-server",
      "scripts/create-admin.ts",
      "--name",
      "admin",
      "--email",
      "admin@example.com",
    ],
    { ...env, ADMIN_PASSWORD: password }
  );
  run("npx", ["tsx", "--conditions=react-server", "scripts/seed-demo.ts", "--actor", "admin"], {
    ...env,
    SEED_CREDENTIALS_FILE: ".local/e2e-seed-credentials.txt",
  });
  run(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/seed-demo-timelines.ts", "--actor", "admin"],
    env
  );

  fs.mkdirSync(".local", { recursive: true });
  fs.writeFileSync(".local/e2e-admin-password.txt", password);
  // A cached session belongs to the previous database.
  fs.rmSync(".local/e2e-session.json", { force: true });

  console.log(`[e2e] starting Next.js on port ${port}`);
  const server = spawn("npx", ["next", "dev", "-p", port], {
    env: { ...env, NEXT_DIST_DIR: ".next-e2e" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const stop = () => server.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
