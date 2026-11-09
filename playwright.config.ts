import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Locally, opens every main page once so the development server compiles it before the tests.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry locally absorbs the dev server's occasional dropped keep-alive connection;
  // a test that only passes on retry is still reported as flaky.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI tests the production build against its own database. Locally the tests get their own
    // fresh database and server (scripts/e2e-server.ts), so they never write into the dev data.
    // E2E_REUSE_SERVER=1 keeps an e2e server that is already running instead of starting afresh.
    command: process.env.CI
      ? `npm run start -- -p ${PORT}`
      : `npx tsx scripts/e2e-server.ts ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE_SERVER === "1",
    // Creating, migrating and seeding the database comes before the first compile.
    timeout: 300_000,
  },
});
