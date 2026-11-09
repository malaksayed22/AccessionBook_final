# Design system

Calm, dense, and legible: a tool people use for hours to keep records that regulators read. Structure and rules follow the
ADLC app; the palette is Accession Book's teal.

## Tokens (`src/styles/tokens.css`)

- One semantic palette, light and dark. **Components never use raw colours.** Tailwind utilities exist for every token:
  `bg-bg`, `bg-surface`, `bg-raised`, `bg-sunken`, `bg-hover`, `border-border`, `border-border-input`, `text-fg`,
  `text-fg-secondary`, `text-fg-tertiary`, `bg-accent`, `text-on-accent`, `text-accent-text`, `bg-accent-soft`, and for
  `success|warning|danger|info`: `text-<s>`, `bg-<s>-soft`, `border-<s>-soft-border`.
- **Contrast is a test** (`src/styles/tokens.test.ts`): every text/surface pair is checked against WCAG 2.2 AA (4.5:1 text,
  3:1 for control borders and the focus ring) in both themes, parsed from the CSS so it cannot drift. Change a colour,
  run the test.
- `prefers-contrast: more` strengthens borders and tertiary text. `prefers-reduced-motion` is honoured globally.
- The pre-P4 colour aliases and the unlayered legacy stylesheet were deleted in P5; only tokens remain.

## Theme

`light`, `dark` or `system`, stored in the `ab_theme` cookie. The server writes `<html data-theme>` on the first byte, so
there is no flash and no inline script (which the CSP would otherwise need). `system` leaves the attribute off and
`prefers-color-scheme` decides.

## Primitives (`src/components/ui`, gallery at `/en/dev/ui`, development only)

Button, IconButton, Field + Input/Textarea/Select/Checkbox, Badge, StatusBadge, Panel, PageHeader, Breadcrumbs, Banner,
Tabs, DropdownMenu, Dialog, Sheet, ConfirmDialog (typed phrase and reason for irreversible actions), Toast, Skeleton,
EmptyState, LockedState, DataTable + SortHeader + Pagination + FilterChips (state lives in the URL).

Rules every primitive follows: native elements first; visible focus; status is never colour alone (icon and text);
errors are announced through a live region; 44 px touch targets on coarse pointers; all built-in text comes from
`messages/*/ui.json`; layouts wrap instead of truncating so French (about 30 % longer) fits. `Radix` supplies focus
trapping, Escape handling and focus restore for overlays. A Playwright spec (`e2e/ui-primitives.spec.ts`) runs axe on the
gallery in English and French, light and dark.

## Shell (`src/components/shell`)

Grouped navigation (Overview, Inventory, Quality, Records, Administration) defined once in `nav-config.ts`; sidebar on
wide screens, drawer on narrow ones; top bar with breadcrumbs, command palette (Ctrl/⌘+K, an ARIA combobox), language
switch, theme toggle and account menu; skip link; `aria-current="page"` on the active item. `e2e/shell.spec.ts` covers
keyboard operation, the drawer, language and theme persistence and axe on the shell.

## Adding or rebuilding a page (P5 checklist)

1. Put text in `messages/<locale>/<area>.json`, both languages; `useTranslations`/`getTranslations`, never literals.
2. Build with the primitives; no raw colours; no new unlayered CSS.
3. Call `requirePageUser()` first; read data through `features/*/queries.ts`.
4. Add the file to the `i18next/no-literal-string` list in `eslint.config.mjs`.
5. Add an axe check for both languages and both themes.

## Charts (`src/components/charts`)

Hand-built SVG, no chart library: nothing to patch, nothing inline-scripted (CSP), full control of accessibility.
`<Chart kind="line" | "column">` takes plain, already translated data (`slots`, `series`) from a server component
(see `TrendCharts.tsx`) and gives every chart the same behaviour:

- **Form follows the job.** One series over time is a line with a wash (accent teal); magnitude per period is
  stacked columns; pass versus fail uses the status colours. Never dual axes, never pies.
- **Colour.** Categorical slots 1 to 3 are fixed in order (`--color-chart-1..3`), validated with the dataviz palette
  checker (adjacent CVD separation, lightness band, 3:1 on the surface) and re-checked by `tokens.test.ts`. Slot 3 is just
  under 3:1 on the light surface, which is why every chart has a legend and a table view. Text never wears a series colour.
- **Marks.** 2px lines, an 8px end dot with a surface ring, columns at most 24px with a 4px rounded data end and a 2px
  surface gap between stacked segments, hairline solid gridlines.
- **Interaction.** Pointer or keyboard (focus the plot, Left/Right/Home/End, Escape): crosshair or highlighted column, one
  tooltip listing every series, and the same sentence announced through a polite live region.
- **Ring gauge** (`RingGauge`): one ratio with a verdict in words ("Mostly passing"), a clockwise ring, and a footnote that
  says what is and is not counted. Colour (success, warning, danger, neutral for no data) only reinforces the words;
  thresholds and wording live in `features/dashboard/health.ts`.
- **Donut** (`DonutChart`): part-to-whole for at most six slices (colour slots 1 to 4, slices separated by air). The legend
  is the keyboard path (links to the filtered list, value and share) and highlights its slice; use a bar list instead when
  close values must be compared.
- **Table view** under every chart (a `<details>` with caption and all values): nothing depends on hover or colour.
- **Time range** is a URL parameter (`?range=7|30|90`) that rescopes every chart on the dashboard; days are calendar
  days in the laboratory time zone, and long ranges bucket movements by week.

Adding a chart: build the data in `features/<area>/<trend>.ts` (pure bucketing in a `*-math.ts` with unit tests, one query
that applies the read scope), format labels in a server component, add translated titles and an empty-state message in
both languages, and add axe, hover and keyboard checks like `e2e/dashboard-charts.spec.ts`.
