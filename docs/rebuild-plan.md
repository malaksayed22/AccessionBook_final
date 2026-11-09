# Accession Book — production-grade rebuild

## Context

Accession Book is a traceability/compliance system of record for regulated material (first customer: a Canadian cannabis research lab, Université Laval; records are inspected by Health Canada). The current code is an investor demo. Three read-only audits plus my own checks found problems at every layer, so this is a rebuild of the architecture, not a polish:

- **Security:** session cookie is the unsigned user id (forgeable); uploads are written to `public/uploads` (no auth, no size/type limits, html/svg → stored XSS); no input schemas; no rate limiting; hardcoded `OMAR_PASSWORD` and username-as-default-password; 20 npm vulns (1 critical, in `next`); no security headers/CSP; unauthenticated-cookie bypass means any value of `accessionbook_session=<id>` is full admin takeover.
- **Data integrity (matters most for Health Canada):** audit rows are written _outside_ the business transaction; unit PATCH edits history in place with no audit/ledger entry; transfer/stage-transition drop `FlowerState`/`SeedLotState` so CTLS figures go wrong; shipments never touch inventory; ids allocated `max+1` (races); "current state" derived in 4 copy-pasted places loading whole tables; enums are free strings; no `createdAt/updatedAt`; no index on hot paths; audit is append-only only by convention.
- **Frontend:** `globals.css` is a frozen _compiled_ Tailwind file (no source — new utilities do nothing); ~125 raw colour usages that fail AA on the light theme; 17 hand-rolled tables, 3 hand-rolled overlays, 12+ forms with manual fetch; no `loading/error/not-found`; modal has no focus trap/Escape/ARIA; 1,400–1,800 hard-coded English strings; 1,223-line wizard.
- **Platform:** no git, tests, CI, Docker, env validation or logging; 129-file `src/next-devtools/` junk copy; 18 stray `%5Bid%5D` duplicate route dirs; SQLite single file; project lives in OneDrive.

The owner explicitly authorised restructuring architecture/layout to reach ADLC-level quality (ADLC = their internal SDLC app, used as design reference: AA-checked tokens, primitives, "next best step" UX). **Confirmed decisions:** PostgreSQL · AWS `ca-central-1` · built-in DB-backed sessions + MFA (keeps the invite flow already built) · next-intl with `/en` and `/fr` URL prefixes · keep Accession Book's teal brand, adopt ADLC's structure and rules. No production data exists yet, so the data model can be redone cleanly; only the legacy Cannabase importer needs porting.

## Target architecture (Next.js 16 monolith, feature-sliced, Data Access Layer)

```
src/
  app/[locale]/(marketing)|(auth)|(app)/…   routes only: parse params → call feature query → render
                                            + loading.tsx / error.tsx / not-found.tsx per segment
  app/api/…                                 thin adapters only: health, file up/download, exports, scan, external callers
  proxy.ts                                  locale negotiation + CSP nonce + security headers + cheap session-cookie gate
  server/                                   server-only: db, env (zod), auth/session, authz policies, audit (withAudit(tx)),
                                            errors (typed codes), http (withApi wrapper), rate-limit, storage (S3), logger (pino)
  features/<unit|experiment|shipment|qa|recall|report|member|organization|location|cultivar|compliance|audit>/
      queries.ts (server-only reads) · service.ts (transactional writes) · schemas.ts (zod) · components/
  components/ui/                            design system primitives (Radix/Base UI + cva)
  components/shell/                         AppShell, Sidebar, Topbar, CommandPalette, LocaleSwitcher, ThemeToggle
  i18n/ + messages/{en,fr}.json             next-intl; locale-aware Intl formatters
  lib/                                      pure utilities only
infra/                                      Pulumi (Python, mirrors ADLC's infra/) · docker/ · .github/workflows/
```

Rules: pages never call Prisma directly (only `features/*/queries.ts` via the DAL); every mutation goes through a service inside one DB transaction that also writes its audit row; every route handler uses `withApi()` (session → authz policy → origin/CSRF check → zod parse → typed error mapping with i18n error _codes_, not English strings).

## Phases (sequential foundation, then parallelisable)

### P0 — Foundations & hygiene

- `git init`, real `.gitignore`; delete `src/next-devtools/`, all `%5Bid%5D` dirs, stale artefacts; recommend moving the repo out of OneDrive.
- Upgrade deps (`next` patch, `npm audit fix`, drop vulnerable transitive paths); TypeScript `strict` + `noUncheckedIndexedAccess`; ESLint (+ `jsx-a11y`, import-boundary rules enforcing the layering above); Prettier.
- Test stack: Vitest (unit), Postgres integration tests (Testcontainers), Playwright (e2e) + axe (a11y) in EN and FR.
- CI (GitHub Actions): lint · typecheck · unit · integration (Postgres service) · e2e · `npm audit` · gitleaks · build image. Mirrors ADLC's OIDC-to-AWS pattern (no stored keys).
- `server/env.ts` (zod-validated env, fail fast), `server/logger.ts` (pino, request id, PII redaction), `/api/health` + `/api/ready`.
- **Restore Tailwind source:** new `globals.css` = `@import "tailwindcss"` + `@theme` tokens (~150 lines); compiled file archived outside `src/`. Verify build before anything else.
- `Dockerfile` (multi-stage, non-root) + `docker-compose.yml` (Postgres 16) for local dev.

### P1 — Data foundation (PostgreSQL, schema v2)

> **Plan adjustment (P1):** enums, the single-table state model, `UnitHold`, `Decimal` weights, the
> autoincrement conversion of the three batch-created tables, the importer rewrite and the demo dataset
> move from P1 to P2, because they are rewritten together with the services that own them. P1 delivered
> the PostgreSQL platform, the integrity constraints and the tamper-evident audit trail. See
> `docs/architecture.md`.

Fresh baseline migration (no prod data). Prisma 7 + `@prisma/adapter-pg`. Changes (from the data audit):

- `autoincrement` ids everywhere; delete `src/lib/id-allocator.ts` and every `getNext*Id`; sequence-backed `ecode`/shipment references.
- Real enums: `UnitType, SourceType, GrowthStage, HoldStatus, PermissionLevel, ShipmentDirection/Status, MaterialType, Measure, Moisture, TestVerdict, IncidentSeverity/Status, AuditAction, AuditEntityType`.
- **Single immutable `UnitState` event table** (merge `PlantState/FlowerState/SeedLotState`; add `locationId`, `eventType`, per-unit `sequence`, `effectiveAt` vs `recordedAt`); `BiologicalUnit.currentStateId` maintained in the same transaction → one "current state" source replaces the 4 copies. Drop `Store`, marker tables, `UnitState.type`, `Plant.originName`; one lineage source.
- `UnitHold` table (history, who placed/released, source manual/auto) replaces the 3 columns on the unit.
- Shipments become inventory events (`ShipmentItem.stateId`; shipping creates `SentTo`/`ReceivedFrom` + CTLS reduction in the same transaction); `Decimal(12,3)` weights.
- `createdAt/updatedAt/createdById` on mutable models; `voidedAt/By/reason` soft-delete on attachments, shipments, tests, incidents (never hard-delete regulated rows); `User.email` unique (citext); needed indexes (`UnitState(unitId,date)`, `AuditLog(entityType,entityId,createdAt)`, etc.); partial unique indexes (one active hold, one destruction per unit).
- **Append-only audit:** Postgres trigger rejects UPDATE/DELETE; `Json` before/after, `requestId`, `ip`, `reason`, `prevHash`/`hash` chain; written via `withAudit(tx, …)` in the same transaction as the change. UTC `timestamptz` + one lab-timezone setting for report boundaries.
- Idempotent, audited importer (port `scripts/import-cannabase.ts`, never truncates); idempotent seed (reference data + realistic demo dataset for investors); delete `apply-schema-additions.ts`.

### P2 — Server core (DAL, services, policies)

`server/authz` policy functions (role + experiment membership, hold/destroyed guards) used identically by pages, route handlers and services; `withApi()` wrapper; typed error codes; one `stateEngine` service implementing create/transfer/stage-change/derive/hold/destroy/ship atomically (fixes the data-loss and non-atomic bugs found); reports/compliance rewritten on indexed queries; batch operations in one transaction.

### P3 — Security core

- Sessions: `Session` table, 256-bit opaque token (hash stored), `__Host-` cookie, httpOnly/Secure/SameSite=Lax, idle 30 min / absolute 12 h, rotation on login & privilege change, revoke on deactivate/password change, "active sessions" list.
- Login hardening: DB-backed rate limit (IP + account), lockout/backoff, generic errors, timing equalisation; Argon2id with rehash-on-login; 12-char policy (+ breached-password check); remove `OMAR_PASSWORD`/default passwords.
- **MFA:** TOTP + recovery codes, mandatory for ADMIN; re-auth for sensitive actions (destroy, release hold, role change).
- CSRF: Origin/Host verification on every mutation + SameSite; full security headers + nonce CSP via `proxy.ts` (HSTS, nosniff, frame-ancestors none, Referrer-Policy, Permissions-Policy).
- Uploads: private S3 (SSE-KMS), size cap, magic-byte allow-list (no html/svg), streamed through an authenticated route or short-TTL presigned URL, `Content-Disposition: attachment`, AV-scan hook, audited delete → void.
- `/scan/[id]` requires sign-in then redirects (QR labels still work); input schemas (zod) on every handler; auth events (login, failure, lockout, MFA, logout, invite) in the audit log; invite emails via SES (replaces copy-link-only).
- **Authorization matrix (from the security audit):** a single `requireUser`/policy layer used by every page and route (the proxy only checks cookie _presence_; 12 pages read Prisma with no session check). Reads scoped by experiment membership (today any REGULAR user can read every unit, lab test, ledger, recall tree, shipment). Role gates: shipments create/update (any user can currently edit custody/licence/manifest fields, and those edits are barely audited), hold release (separate from placing it), destroy (mandatory reason + second approver/admin), lab-test verdict **computed server-side** (client currently asserts it and can override a FAIL). Authorize every referenced id (lineage parent, `sourceUnitId`, `experimentId`, `cultivarId`) and add a lineage cycle check. Unit PATCH may no longer move location/stage outside the transfer/stage ledger.
- **Input & output hygiene:** zod `.strict()` schemas + body-size limits on every handler (positive-int ids, bounded strings, numeric ranges); never return `error.message`; CSV export formula-injection escaping; `next=` redirect allow-list (current check accepts `/\evil.com`); select explicit columns (never load `passwordHash`); member emails visible to admins only.
- **Privacy (PIPEDA / Quebec Law 25):** data-minimisation, access/export and erasure workflow (deactivate + anonymise, keep audit snapshots), retention schedule, breach register, access logging of personal data.
- **Dependency/CI security:** `next` critical advisory (20 findings today: 1 critical, 13 high, 6 moderate) → upgrade; Dependabot, CodeQL, gitleaks, container scan in CI.

### P4 — Design system, shell, i18n scaffolding

- Tokens ported from ADLC `index.css` (type/space/radius/shadow scales, WCAG-AA pairs verified in light **and** dark, `prefers-contrast`), Accession Book teal accent; theme = light/dark/system via cookie (no flash).
- Primitives (`components/ui`): Button (variants/sizes/loading), Input/Select/Textarea/Field (label+hint+error with `aria-describedby`), Badge + one `StatusBadge` tone map (icon + label, never colour alone), Panel, PageHeader, Banner, Tabs (roving focus), Dialog/Sheet (focus trap, Esc, restore), Toast, Skeleton, EmptyState/LockedState ("what's missing + one button", as in ADLC), server `DataTable` (+ `scope`, `aria-sort`, caption, URL-driven sort/filter/pagination, sticky header, density toggle), Pagination, FilterChips.
- Shell: grouped navigation (Overview · Inventory · Quality · Records · Admin), `aria-current`, breadcrumbs, skip link, rebuilt command palette, locale switcher, mobile drawer with focus trap.
- i18n: `next-intl`, `app/[locale]`, `proxy.ts` composes locale redirect + auth gate + CSP; `messages/en.json` + `fr.json` (fr-CA terminology, +30 % text-growth tolerance); `<html lang>`; `Intl` formatters (fr-CA numbers/currency, ISO dates retained for regulatory exports); API returns error codes translated client-side; lib catalogs (`action-catalog`, `report-catalog`, `lifecycle-stages`, `qa-constants`) return keys not labels.

### P5 — Section-by-section migration (each = UI + service + tests + EN/FR strings + a11y check)

Order: Auth (login/invite/profile/MFA) → Shell + Dashboard ("Today": what needs attention, next best step) → All-Seeing Eye (compliance) → Units (list/detail/actions; split 511-line profile) → Experiments (split the 1,223-line wizard) → Materials in/out → Quality & holds → Recall → Destroyed register → Locations/Cultivars/Organizations → Members → Reports (CTLS, print/PDF stylesheets) → Activity (audit viewer + hash-chain verify) → Marketing site. Regulated-UX rules throughout: typed confirmation + witness capture for irreversible actions, "who/what/when" history panel on every record, time-zone-explicit timestamps.

### P6 — Infrastructure & delivery (mirrors ADLC's `infra/`: Pulumi, ECS Fargate, ECR, GitHub OIDC)

AWS `ca-central-1`: VPC with private subnets · RDS PostgreSQL 16 Multi-AZ, KMS-encrypted, PITR, deletion protection · ECS Fargate behind ALB (ACM TLS, WAF managed rules + rate rule) · S3 attachments (versioned, SSE-KMS, block public access) · Secrets Manager · SES (invites) · CloudWatch logs/alarms · ECR scan-on-push · staging + prod · GitHub Actions deploys with approval gate and migration step.

### P7 — Hardening & readiness

Threat model; OWASP ASVS L2 checklist; dependency + container scan gates; backup/restore drill; load test; WCAG 2.2 AA audit (axe + manual) in EN/FR; runbook, data dictionary, and a lightweight validation pack (requirements → tests traceability) for Health Canada inspection; investor demo dataset and script.

## Execution approach

P0 → P1 → P2 → P3 sequentially (one thread; each is a dependency of the next). After P2, **P3, P4 and P6 are independent** and can run as parallel sessions in separate worktrees. After P4, P5 sections can be split across sessions by feature folder (no shared files). I will commit per phase on a branch with a CHANGELOG entry; nothing is pushed or deployed without your say-so.

## Verification (per phase gate, then end-to-end)

- Every phase: `lint`, `typecheck`, unit + Postgres integration tests green; Playwright e2e for that phase's flows in EN and FR; axe reports zero serious/critical violations; light and dark checked visually in the browser.
- P1: migration applies to empty Postgres; importer re-runs without duplicates or orphaned history; audit trigger rejects UPDATE/DELETE; hash-chain verifier passes and detects a tampered row.
- P2: concurrency test (parallel create/transfer/destroy) produces no id collisions and no partial writes; killing a request mid-transaction leaves no change _and_ no audit row.
- P3: forged/unsigned cookie rejected; session expiry/rotation; lockout; MFA enrol/login/recovery; CSRF cross-origin POST blocked; upload of `.html/.svg`/oversize rejected, files not reachable without a session; CSP/headers present (check with a header scanner); `npm audit` clean at high/critical.
- P4/P5: keyboard-only walkthrough of every section; screen-reader spot checks; no hard-coded strings (lint rule on JSX literals); `/en` and `/fr` parity script fails on missing keys.
- P6: deploy to staging; failover and restore drill; WAF rule test.
- End-to-end: invite → accept → MFA → create experiment → register units → transfer → stage change → hold on failed test → recall trace → ship → destroy with witness → CTLS monthly report → audit chain verifies — in both languages.

## Assumptions / risks

- No production data to migrate (confirm). Legacy Cannabase SQL dump is not in the repo; importer is ported and tested against a synthetic dump until the real one is provided.
- Scale is large (~27k lines ts/tsx today); phases are sized so each ends in a working, tested app. Scope control: marketing site and Take-Action hub rebuilt last.
- Health Canada validation expectations to be confirmed with the customer's QA lead (record retention periods, e-signature requirements).
