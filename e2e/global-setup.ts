import { e2eCredentials } from "./helpers";

/**
 * Locally the tests run against a development server (scripts/e2e-server.ts), which compiles each
 * page the first time it is asked for. Opening every main page once here, before the first test,
 * keeps that one-off compile out of the tests' time limits. CI tests a production build: nothing to
 * warm there.
 */
const PAGES = [
  "/en",
  "/en/login",
  "/en/dashboard",
  "/en/inventory/units",
  "/en/inventory/experiments",
  "/en/inventory/experiments/new",
  "/en/inventory/materials",
  "/en/inventory/materials/new",
  "/en/inventory/destroyed",
  "/en/quality",
  "/en/quality/recall",
  "/en/records/cultivars",
  "/en/records/locations",
  "/en/records/organizations",
  "/en/records/organizations/new",
  "/en/records/members",
  "/en/compliance/reports",
  "/en/compliance/reports/ctls-monthly",
  "/en/compliance/audit",
  "/en/profile",
  "/en/search?q=ab",
  "/en/dev/ui",
];

/** Detail pages need a record id: the first one each list links to. */
const DETAIL_LINKS = [
  { list: "/en/inventory/units", pattern: /href="(\/en\/inventory\/units\/\d+)"/ },
  { list: "/en/inventory/experiments", pattern: /href="(\/en\/inventory\/experiments\/\d+)"/ },
  { list: "/en/inventory/materials", pattern: /href="(\/en\/inventory\/materials\/\d+)"/ },
  { list: "/en/records/cultivars", pattern: /href="(\/en\/records\/cultivars\/\d+)"/ },
  { list: "/en/records/organizations", pattern: /href="(\/en\/records\/organizations\/\d+)"/ },
  { list: "/en/records/members", pattern: /href="(\/en\/records\/members\/\d+)"/ },
];

export default async function globalSetup() {
  if (process.env.CI) return;
  const base = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
  const credentials = e2eCredentials();
  if (!credentials) return;

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(credentials),
  });
  if (!login.ok) return;
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const open = async (path: string) => {
    const response = await fetch(base + path, {
      headers: { cookie },
      signal: AbortSignal.timeout(180_000),
    });
    return response.text();
  };

  const started = Date.now();
  for (const path of PAGES) await open(path);
  for (const { list, pattern } of DETAIL_LINKS) {
    const detail = (await open(list)).match(pattern)?.[1];
    if (detail) await open(detail);
  }
  console.log(`[e2e] pages compiled in ${Math.round((Date.now() - started) / 1000)} s`);
}
