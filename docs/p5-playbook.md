# P5 playbook: rebuilding a section

Every section page and component that still carries pre-P4 UI is rebuilt on the design system, in English and
French, reading data through `features/*/queries.ts`. The **reference implementation is the units list**:
`src/app/[locale]/(app)/units/page.tsx`, `listUnits` in `src/features/unit/queries.ts`,
`messages/*/units.json`, `tests/integration/unit-list.test.ts`, `e2e/units-list.spec.ts`. Read all five before
starting; copy their shape.

## Definition of done (per page or component)

1. **No legacy UI.** Built from `components/ui` and `components/page` (primitives, `StatCard`, `SearchForm`,
   `SelectFilter`, domain badges). No raw colours, no `var(--bg-card)`-style legacy variables, no new CSS files,
   no `style={{}}` colours, no native `alert/confirm`. Delete the old component when its last caller is gone.
2. **Both languages.** Every visible string comes from `messages/<locale>/<area>.json` through
   `useTranslations` / `getTranslations`; English and French have identical keys and placeholders (the parity test
   fails otherwise). Domain vocabulary (unit type, stage, hold kind, ...) is already in `domain.json`:
   `t(`domain.unitType.${type}`)`, or use `components/page/domain-badges`. Dates and numbers go through
   `getFormatter()` / `useFormatter()` (`format.dateTime(d, "dateTime")`, `"date"`, `"isoDate"`,
   `format.number(g, "grams")`, `"count"`, `"percent"`), never `toLocaleString`. Plurals use ICU:
   `{count, plural, one {# unit} other {# units}}`. French is natural Canadian French, typographic apostrophes (’),
   regulatory terms as in `domain.json`. **Never hard-code text in a `lib/` catalog:** catalogs return keys or
   enum values and the UI translates.
3. **Data layer.** Pages and components never import `@/server/db`, `@/generated/*` or Prisma. Reads live in
   `src/features/<domain>/queries.ts` (`import "server-only"`), take the signed-in user, apply
   `unitReadScope(user)` (units) or the equivalent, and return plain view models. **Filtering, sorting, search and
   pagination happen in the database** (`where`, `orderBy`, `skip/take`, `count`), never by loading every row and
   slicing in memory. Free-text search goes through `likeEscape`. Writes stay in `service.ts` (transaction + audit).
4. **Pages.** Server components, `export const dynamic = "force-dynamic"`, first lines
   `await resolveRequestLocale(params); const user = await requirePageUser();` (every page checks the session:
   the proxy only checks that a cookie exists). `generateMetadata` returns a translated title. URL is the state
   (search, filters, sort, page) via `buildListUrl`, `pickParam`, `positiveIntParam`; every URL parameter is
   untrusted and validated. Empty states say what is missing and offer one action (`EmptyState`); "no match" and
   "nothing yet" are different states.
5. **Forms and actions.** `Field` + `Input/Select/Textarea`, `Button` with `loading`, errors via `useApiError()`
   (translated from the API's error `code`), network failures via `useNetworkError()`, requests via `sendJson`
   (`src/lib/client-api.ts`; it opens the password re-confirmation dialog by itself when the server answers
   `REAUTH_REQUIRED`). Irreversible actions (destroy, release hold, void, deactivate) use `ConfirmDialog` with a
   reason and, for destruction, a typed phrase; show success with `useToast`. Never navigate on a failed request.
   Server component to client component props must be serialisable: **no functions** (pass precomputed `href`s or
   ids), and Prisma `Decimal`/`Date` become strings/numbers first.
6. **Accessibility.** One `h1` per page; headings in order; tables via `DataTable` (caption, `scope`, `aria-sort`);
   icon-only buttons are `IconButton` with a `label`; focus is visible and keyboard operation works;
   `aria-current` on active items; status is never colour alone (use the badges). Every page passes
   `expectNoBlockingViolations(page)` (`e2e/a11y.ts`) in `en` and `fr`, light and dark.
7. **Tests.** (a) Integration test for every non-trivial query (filters, sort, paging, scoping, search
   safety); (b) unit tests for pure logic you add or move; (c) a Playwright spec per section like
   `e2e/units-list.spec.ts` covering axe in the four combinations and the main interaction paths.
8. **Lint.** Remove each rebuilt file's line from `eslint.legacy.mjs` (the strict rules then apply to it:
   no literal JSX text, no database imports). `npx eslint <your files>` must be clean. The legacy list only
   shrinks.

## Mechanics

- **Files are yours or not yours.** Edit only the files assigned to you plus new files you create. Shared kit
  (`components/ui`, `components/page`, `components/shell`, `src/i18n`, `src/lib/client-api.ts`, `eslint.config.mjs`,
  `package.json`, `prisma/**`, `messages/*/{common,ui,shell,auth,errors,domain}.json`) belongs to the lead: do not
  edit it. If you need something from it, build a small component in your own area and say so in your report. You
  may add keys to your own message area files only; use the area names in `src/i18n/messages.ts`.
  If you must change an exported component that other sections import, keep its props backwards compatible.
- **Services and APIs.** You may change files under your `features/<domain>/` and your `app/api/...` routes. Keep
  every route on `withApi` (zod schemas, same-origin check, uniform errors). Keep `ctx.requireRecentAuth()` on
  destroy, hold release, deactivate and MFA reset.
- **Tool traps (real, hit before):**
  - Code containing backslashes (regexes, escapes) must be written with the Write or Edit tools. Shell here-docs
    (`cat <<EOF`, `python - <<EOF`) silently turn `\\` into `\`.
  - `MenuItem asChild` needs exactly one child; with `asChild` do not pass `icon`.
  - Radix `starting:` CSS and `next dev` are slow on first compile of a route: allow 20 s navigations.
  - Interactive controls only work after hydration: use `waitUntil: "networkidle"` after navigations in specs.
  - On Windows file names are case-insensitive: never create `Foo.ts` next to `foo.tsx`.
  - Prisma client is cached by the dev server: restart `next dev` after schema changes (there should be none).
- **Running things.** One `next dev` serves the repo on port 4000; never start a second one, never stop one you did
  not start. Run Playwright against it with `E2E_PORT=4000 npx playwright test <spec> --output=test-results-<yourarea>`
  (separate output directory, or parallel runs delete each other's artifacts), 2 workers at most. Sign-in is cached by
  `e2e/helpers.ts#signIn`; do not call the login API in loops (it is rate limited: if blocked, run
  `node .local/clear-limits.mjs`). The development database is shared by every section and is not reset: specs may
  read it, and may create records whose names start with `E2E-` plus a timestamp (regulated rows are never deleted),
  but must not assert global counts or depend on records they did not create. Integration tests
  (`npx vitest run --project integration <file>`) use their own throwaway database.
- **Verification before you report:** `npx tsc --noEmit` (errors in files you do not own are other people's
  in-progress work; report only yours), `npx eslint <your files>`, `npx prettier --write <your files>`,
  `npx vitest run --project unit` for your pure logic, your integration tests, your Playwright specs. Report real
  results, including what you could not verify.
