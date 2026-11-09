import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` throws outside the Next.js server bundle; tests run in plain Node.
  "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/lib/**", "src/features/**"],
      exclude: ["src/generated/**", "**/*.test.ts"],
      reporter: ["text-summary", "lcov"],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          env: { DATABASE_URL: "postgresql://unit:unit@localhost:5432/unit" },
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          // Production-like security settings, so the guarded paths are the ones under test.
          env: { REQUIRE_ADMIN_MFA: "true", REQUIRE_REAUTH: "true" },
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // One shared database: files run one after another, each resetting it first.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
