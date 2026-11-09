import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";
import { LEGACY_FILES } from "./eslint.legacy.mjs";

/**
 * Layering (see docs/architecture.md):
 *   components/ui, components/shell → pure presentation, no data or server code
 *   app/**                          → routes only; data comes from features/*  queries
 *   features/*                      → own their queries, services and schemas
 * Legacy pages that still reach into the database directly are reported as
 * warnings; CI ratchets the warning count down (lint:ci) until it reaches zero.
 */
const DB_ACCESS = [
  {
    group: ["@/lib/db", "@/server/db", "@/generated/*", "@prisma/client"],
    message:
      "Pages and components must read data through features/*/queries.ts, not the database client.",
  },
];

const PRESENTATION_ONLY = [
  {
    group: ["@/features/*", "@/server/*", "@/lib/db", "@/generated/*", "@/app/*"],
    message:
      "components/ui and components/shell are presentation-only: no features, server or database imports.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_`-prefixed bindings are deliberate omissions, e.g. dropping a relation
      // from a payload with `const { members: _m, ...rest } = row`.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Legacy marketing/sidebar components trip this; they are rewritten in P4/P5.
      "react-hooks/set-state-in-effect": "warn",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='alert'], CallExpression[callee.name='confirm']",
          message:
            "Use the Dialog/Toast primitives; native alert() and confirm() are not accessible or translatable.",
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**", "src/components/shell/**"],
    rules: { "no-restricted-imports": ["warn", { patterns: DB_ACCESS }] },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}", "src/components/shell/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: PRESENTATION_ONLY }] },
  },
  {
    // Strict areas: every route and component that is not on the legacy list (eslint.legacy.mjs).
    // Visible text must come from messages/<locale>, and data is read through features/*/queries.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui/**",
      "src/components/shell/**",
      "src/components/page/**",
      "src/app/[[]locale]/dev/**",
      "**/*.test.{ts,tsx}",
      ...LEGACY_FILES,
    ],
    plugins: { i18next },
    rules: {
      "no-restricted-imports": ["error", { patterns: DB_ACCESS }],
      "i18next/no-literal-string": [
        "error",
        { mode: "jsx-text-only", "jsx-components": { exclude: ["Trans"] } },
      ],
    },
  },
  {
    // Design-system layers: presentation only, and every visible string is translated.
    files: [
      "src/components/ui/**/*.{ts,tsx}",
      "src/components/shell/**/*.{ts,tsx}",
      "src/components/page/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "no-restricted-imports": ["error", { patterns: PRESENTATION_ONLY }],
      "i18next/no-literal-string": [
        "error",
        { mode: "jsx-text-only", "jsx-components": { exclude: ["Trans"] } },
      ],
    },
  },
  {
    // Infrastructure probe: the readiness check exists to query the database.
    files: ["src/app/api/ready/route.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["scripts/**/*.ts", "e2e/**/*.ts", "**/*.config.{ts,mjs}"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "test-results-*/**",
    ".local/**",
    "src/generated/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
