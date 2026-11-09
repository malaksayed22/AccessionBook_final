# Architecture

Accession Book is a Next.js 16 (App Router) monolith. The rules below are enforced by
ESLint (`eslint.config.mjs`) and reviewed in CI; the full rebuild roadmap is in
[`rebuild-plan.md`](./rebuild-plan.md).

## Layers

```
src/
  app/                 routes only: parse params -> call a feature query -> render
  proxy.ts             locale, CSP nonce, security headers, cheap session-cookie gate
  server/              server-only: db, env, logger, auth/session, authz, audit, http, storage
  features/<name>/     queries.ts (reads) · service.ts (transactional writes) · schemas.ts (zod) · components/
  components/ui/       design-system primitives (presentation only)
  components/shell/    app shell (presentation only)
  lib/                 pure utilities, safe to import anywhere
```

Dependency direction: `app -> features -> server`, and `components/* -> lib` only.
`components/ui` and `components/shell` may not import features, server code or the
database client (lint error). Pages reaching into the database are reported as lint
warnings; `npm run lint:ci` ratchets that count down until it is zero.

## Principles

1. **One transaction per mutation.** A business change and its audit row commit together or not at all.
2. **Authorization in one place.** Policy functions in `server/authz`, used identically by pages, route handlers and services. The proxy is never the only check.
3. **Validate every boundary.** zod schemas on every request body; typed error _codes_ back, translated in the UI.
4. **Regulated records are never destroyed.** Void/soft-delete with who, when and why; the audit log is append-only.
5. **Secrets only through `server/env.ts`.** Nothing else reads `process.env`.

## Status

| Phase                                                  | State                            |
| ------------------------------------------------------ | -------------------------------- |
| P0 Foundations                                         | in progress (this commit series) |
| P1 PostgreSQL platform + integrity                     | done (see "P1 notes" below)      |
| P2 Domain core (state engine, services, authorization) | done (see "P2 notes" below)      |
| P3 Security core                                       | done (see "P3 notes" below)      |
| P4 Design system, shell, i18n                          | done (see "P4 notes" below)      |
| P5 Section migration                                   | done (see "P5 notes" below)      |
| P6 Infrastructure (AWS ca-central-1)                   | planned                          |
| P7 Hardening and readiness                             | planned                          |

## P1 notes (PostgreSQL platform and integrity)

Delivered:

- PostgreSQL 16 via `@prisma/adapter-pg`; `DATABASE_URL` is validated and has no default.
- Fresh baseline migration plus an "integrity" migration: value-set and physical-sanity CHECKs,
  case-insensitive uniqueness (user name/email, organization name), `timestamptz` everywhere.
- **Audit trail enforced by the database:** append-only (UPDATE/DELETE/TRUNCATE rejected),
  hash-chained (`seq`, `prevHash`, `hash` assigned by a trigger under an advisory lock),
  verifiable with `SELECT * FROM audit_verify_chain()`. `logMemberActivity(user, entry, tx)`
  accepts the surrounding transaction so the entry commits atomically with the change.
- Autoincrement ids, `createdAt/updatedAt`, indexes on every foreign key, soft-delete columns.
- Integration tests (`tests/integration`) attack these guarantees: tampering, concurrent writers,
  rollback atomicity, constraint violations.
- Removed: SQLite, `apply-schema-additions`, default-password helpers, the hardcoded admin password.
  Imported legacy members become pending invitations.

Moved to P2 (they are rewritten together with the services that own them, each next to its zod
schema, instead of patching ~60 call sites twice): native enums replacing the CHECKs, the single
immutable `UnitState` table with `currentStateId`, `UnitHold`, `Decimal` weights, autoincrement
for `Experiment`/`BiologicalUnit`/`UnitState`, the idempotent importer rewrite, and the investor
demo dataset.

Known gap carried to P3: the audit chain detects tampering inside history; detecting truncation of
the _tail_ needs the latest hash anchored outside the database (planned with the AWS work), and the
application database role must not own the table (so it cannot disable the triggers).

## P2 notes (domain core)

- **One immutable event table.** `UnitState` rows are the unit's whole history; `BiologicalUnit.currentStateId`
  points at the newest. The database enforces: no update/delete of states, contiguous per-unit sequence,
  nothing after SHIPPED/DESTROYED, a correct current-state pointer, one active hold per unit, no hard
  deletes of regulated records (they are voided with who and why), non-negative weights, native enums.
  See [`domain-model.md`](./domain-model.md).
- **Services own every write** (`features/<domain>/service.ts`): one transaction, authorization, rule
  checks, the event and its audit entry commit together. Row locks on the unit serialise concurrent
  commands (verified: two simultaneous destructions, 8 simultaneous measurements).
- **`withApi`** wraps every route: request id, authentication and the admin gate, same-origin check,
  bounded JSON parsing with zod, uniform error codes, no internal detail leaked.
- **Authorization lives in one file**, `server/authz.ts`. Shipping and receiving, hold release and report
  access are admin-only; unit work needs admin or membership of the unit's experiment.
- **Lab results are records, not judgements**: panel, analyte, value, laboratory and date as reported. There is no pass/fail verdict and no automatic hold from a result; holds are placed by people or by a critical incident.
- **Uploads** are validated by content (PDF/PNG/JPEG/WebP/CSV/TXT only), stored privately with a SHA-256,
  served only through an authenticated route, and voided rather than deleted.
- **Shipments are inventory events:** an outbound shipment that leaves writes a SHIPPED state for each unit in
  the same transaction.
- Remaining before production: design system, shell and French (P4); section-by-section UI rebuild (P5);
  AWS (P6); hardening (P7).

## P5 notes (every section rebuilt)

- All pages and components are on the design system and bilingual; `eslint.legacy.mjs` is empty, so the strict
  rules (no literal JSX text, no database imports outside `features/*`) apply to the whole of `src/app` and
  `src/components`. `docs/p5-playbook.md` is the recipe used.
- Reads live in `features/<domain>/queries.ts` and do filtering, search (LIKE-escaped), sorting and paging in the
  database; units apply `unitReadScope` (one place to narrow read visibility). Writes stay in services.
- Domain vocabulary is one translated catalog (`messages/*/domain.json`) and libs return enum values or keys, not
  English labels.
- New: location and cultivar services (audited), member pseudonymisation and personal-data export, audit-chain
  verification in the audit trail and compliance console, a "state at date" report, a 4-step experiment wizard, a
  Take Action launcher built on `Dialog`, a bilingual public marketing site with per-language metadata.
- Sensitive actions prompt for the password in a dialog (`ReauthProvider`) and retry transparently.
- The browser receives only the message areas client components read (`SERVER_ONLY_AREAS`, test-guarded).
- The legacy stylesheet is gone: `globals.css` keeps base rules and the print sheets (labels, audit export, reports).

Carried forward to P6/P7: French copy needs professional review; report downloads are not yet written to the audit
log; the member data export is a GET (cannot raise the re-auth dialog); duplicate-name conflicts show a generic
message; `assessLocationCapacity` still returns English text; no destruction "method" field exists in the model.

## P4 notes (design system, shell, i18n)

Delivered (details in `docs/design-system.md` and `docs/i18n.md`):

- Audited token palette with a contrast test (WCAG 2.2 AA, both themes); theme in a cookie, rendered on the server.
- `components/ui` primitives with an axe-tested gallery; `components/shell` (grouped navigation, drawer, breadcrumbs,
  command palette, language switch, account menu).
- `next-intl` routing under `src/app/[locale]` (`/en`, `/fr`); proxy composes language, auth gate and headers.
- Typed EN/FR messages with a parity test and a lint rule against hard-coded text in translated areas.
- API errors carry stable codes translated in the browser; sign-in, MFA, invitation and profile are fully bilingual.
- CSP fix found by testing a production build: Radix's scroll-lock `<style>` is now given the request nonce.

Carried forward to P5: every section page and the marketing site still render English text; pages still query Prisma
directly; legacy unlayered CSS and the legacy colour aliases remain until the last page is rebuilt.

## P3 notes (security core)

Delivered (details in `docs/security.md`, `docs/privacy.md`, `docs/storage.md`):

- Opaque database sessions (`server/session.ts`), `__Host-` cookie over https, idle/absolute expiry, rotation, revocation.
- Argon2id passwords (bcrypt removed), common-password deny-list, timing-equalised sign-in.
- PostgreSQL rate limiting and lockout (`server/rate-limit.ts`); client address taken from our own proxy only.
- TOTP MFA with encrypted secrets, replay protection and recovery codes; mandatory for admins in production;
  admin reset; password re-authentication for destroy, hold release, deactivation and MFA reset.
- All `auth/*` routes on `withApi`; auth events in the audit chain (`recordAuthEvent`); open-redirect fix.
- Nonce-based CSP and security headers for every response (`server/security-headers.ts`).
- S3 storage driver (SSE-KMS, write-once) behind the same interface; disk driver kept for development.
- `requirePageUser()` guards pages; the `(app)` layout guards the whole group.

Carried forward: the re-authentication dialog is a plain error until P5; pages still query Prisma directly (P5);
reads are not scoped by experiment membership beyond the P2 policies (P7 review); account recovery by e-mail (P6).
