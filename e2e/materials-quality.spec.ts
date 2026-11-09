import { expect, test, type Page } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

/*
 * Materials in and out, quality and holds, recall trace and the destruction register.
 * Records this spec creates are draft shipments named E2E-<timestamp>; regulated rows are never
 * deleted, and nothing here depends on records it did not create.
 */
/** The dev server compiles a route on first visit, so interaction checks wait longer than the default. */
const check = expect.configure({ timeout: 20_000 });
const STAMP = `E2E-${Date.now()}`;
let fixtures: { axeShipment: number; cancelShipment: number; unit: number | null } | null = null;

async function createDraft(page: Page, label: string): Promise<number> {
  const orgs = await page.request.get("/api/organizations");
  const organizations = ((await orgs.json()) as { organizations?: Array<{ id: number }> })
    .organizations;
  let organizationId = organizations?.[0]?.id;
  if (!organizationId) {
    const created = await page.request.post("/api/organizations", {
      data: { name: `${STAMP} org`, address: "1 Test Street, Quebec City" },
    });
    organizationId = ((await created.json()) as { organization: { id: number } }).organization.id;
  }
  const response = await page.request.post("/api/shipments", {
    data: {
      direction: "INBOUND",
      organizationId,
      status: "DRAFT",
      comment: `${STAMP} ${label}`,
      items: [{ description: `${STAMP} ${label}`, materialType: "SEED", unitCount: 5 }],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { shipment: { id: number } }).shipment.id;
}

/** Creates the records the pages need, once per run, after signing in. */
async function ensureFixtures(page: Page) {
  if (fixtures) return fixtures;
  const units = await page.request.get("/api/qa/units?q=a&scope=any");
  const found = ((await units.json()) as { units?: Array<{ id: number }> }).units ?? [];
  fixtures = {
    axeShipment: await createDraft(page, "axe"),
    cancelShipment: await createDraft(page, "cancel"),
    unit: found[0]?.id ?? null,
  };
  return fixtures;
}

test.describe("materials, quality, recall and destruction register", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  const pages: Array<{ name: string; path: (f: NonNullable<typeof fixtures>) => string | null }> = [
    { name: "materials list", path: () => "materials" },
    { name: "new movement", path: () => "materials/new" },
    { name: "movement detail", path: (f) => `materials/${f.axeShipment}` },
    { name: "quality console", path: () => "qa" },
    { name: "quality holds view", path: () => "qa?view=holds" },
    { name: "recall start", path: () => "recall" },
    { name: "recall trace", path: (f) => (f.unit ? `recall?unit=${f.unit}` : null) },
    { name: "destruction register", path: () => "destroyed" },
  ];

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      for (const entry of pages) {
        test(`${entry.name} ${locale} ${colorScheme}: no serious or critical accessibility violations`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme });
          await signIn(page, locale);
          const path = entry.path(await ensureFixtures(page));
          test.skip(path === null, "no unit available to trace");
          await page.goto(`/${locale}/${path}`, { waitUntil: "networkidle", timeout: 40_000 });
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectNoBlockingViolations(page);
        });
      }
    }
  }

  test("movements: filters, search, dates and sort live in the URL", async ({ page }) => {
    await signIn(page, "en");
    await ensureFixtures(page);
    await page.goto("/en/inventory/materials", { waitUntil: "networkidle", timeout: 40_000 });
    // A status donut, not a row of number cards.
    await check(page.getByRole("region", { name: "Shipments by status" })).toBeVisible();

    await page.getByRole("button", { name: /^Direction/ }).click();
    await page.getByRole("menuitem", { name: "Inbound", exact: true }).click();
    await check(page).toHaveURL(/direction=INBOUND/);
    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitem", { name: "Draft", exact: true }).click();
    await check(page).toHaveURL(/direction=INBOUND.*status=DRAFT|status=DRAFT.*direction=INBOUND/);

    await page.getByRole("searchbox").fill(`${STAMP} axe`);
    await check(page).toHaveURL(/q=E2E-/);
    await check(page.getByRole("table")).toContainText("RCV-");
    await check(page.getByRole("rowheader")).toHaveCount(1);

    await page.getByRole("textbox", { name: "From", exact: true }).fill("2001-01-01");
    await page.getByRole("textbox", { name: "To", exact: true }).fill("2001-12-31");
    await check(page).toHaveURL(/from=2001-01-01.*to=2001-12-31|to=2001-12-31.*from=2001-01-01/);
    await check(page.getByText("No shipments match these filters")).toBeVisible();

    await page.getByRole("link", { name: "Clear filters" }).click();
    await check(page).toHaveURL(/\/en\/inventory\/materials$/);
    await page
      .getByRole("columnheader", { name: /Reference/ })
      .getByRole("link")
      .click();
    await check(page).toHaveURL(/sort=reference/);
    await check(page.getByRole("columnheader", { name: /Reference/ })).toHaveAttribute(
      "aria-sort",
      /ascending|descending/
    );
  });

  test("search treats % as a character, and a bad date is ignored", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/materials?q=%25%25%25&from=2026-02-31", {
      waitUntil: "networkidle",
    });
    await check(page.getByText("No shipments match these filters")).toBeVisible();
    await page.goto("/en/inventory/destroyed?q=%25%25%25&to=not-a-date", {
      waitUntil: "networkidle",
    });
    await check(page.getByText("No destruction matches these filters")).toBeVisible();
  });

  test("movement actions: ConfirmDialog opens from the keyboard, Escape cancels, Enter confirms", async ({
    page,
  }) => {
    await signIn(page, "en");
    const { cancelShipment } = await ensureFixtures(page);
    await page.goto(`/en/inventory/materials/${cancelShipment}`, {
      waitUntil: "networkidle",
      timeout: 40_000,
    });

    const trigger = page.getByRole("button", { name: "Cancel shipment" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await check(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await check(dialog).toBeHidden();
    await check(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await check(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Cancel shipment" });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await check(dialog).toBeHidden();
    await check(page.getByText("Cancelled").first()).toBeVisible();
    // A cancelled movement offers no more status moves, and no records are voided.
    await check(page.getByRole("button", { name: "Mark delivered" })).toHaveCount(0);
    await check(page.getByRole("button", { name: "Void record" })).toHaveCount(0);
  });

  test("new movement: shows translated errors and sends nothing when the form is incomplete", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/inventory/materials/new", { waitUntil: "networkidle", timeout: 40_000 });
    await page.getByRole("button", { name: "Enregistrer l’expédition" }).click();
    await check(page).toHaveURL(/\/fr\/inventory\/materials\/new$/);
    await check(
      page.getByText("Choisissez l’organisation à l’autre bout de cette expédition.")
    ).toBeVisible();
    await check(page.getByText("Décrivez cette ligne.")).toBeVisible();
  });

  test("new movement: asks for tracking and licence, but not an address or a manifest number", async ({
    page,
  }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/materials/new", { waitUntil: "networkidle", timeout: 40_000 });
    await check(page.getByLabel("Tracking number")).toBeVisible();
    await check(page.getByLabel(/Counterparty licence number/)).toBeVisible();
    await expect(page.getByLabel(/^Address/)).toHaveCount(0);
    await expect(page.getByLabel(/^Manifest number/)).toHaveCount(0);
  });

  test("quality console: views, search and the hold and incident dialogs", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/quality", { waitUntil: "networkidle", timeout: 40_000 });
    await check(page.getByRole("region", { name: "Open incidents by severity" })).toBeVisible();
    // Lab results are set aside for now: no stat, section or view for them.
    await check(page.getByRole("heading", { name: /^Lab results/ })).toHaveCount(0);

    await page.getByRole("button", { name: /^Show/ }).click();
    await page.getByRole("menuitem", { name: "Holds", exact: true }).click();
    await check(page).toHaveURL(/view=holds/);
    await page.getByRole("searchbox").fill("zzz-nothing-matches");
    await check(page).toHaveURL(/q=zzz-nothing-matches/);
    await check(page.getByText("Nothing matches this search")).toBeVisible();

    await page.getByRole("link", { name: "Clear search" }).click();
    await check(page).not.toHaveURL(/q=/);

    await page.getByRole("button", { name: "Place a hold" }).click();
    const dialog = page.getByRole("dialog");
    await check(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Place hold" }).click();
    await check(dialog.getByText("Choose the unit to hold.")).toBeVisible();
    await page.keyboard.press("Escape");
    await check(dialog).toBeHidden();

    await page.getByRole("button", { name: "Open an incident" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Open incident" }).click();
    await check(page.getByText("Give the incident a short title.")).toBeVisible();
    await check(
      page.getByRole("dialog").getByRole("textbox", { name: /^What happened/ })
    ).toHaveAttribute("aria-invalid", "true");
  });

  test("recall: search lists matches, an unknown unit says so, the language is kept", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/quality/recall?q=zzz-no-such-unit", {
      waitUntil: "networkidle",
      timeout: 40_000,
    });
    await check(page.getByText("Aucune unité ne correspond")).toBeVisible();
    await page.goto("/fr/quality/recall?unit=999999999", { waitUntil: "networkidle" });
    await check(page.getByText("Cette unité est introuvable")).toBeVisible();

    const { unit } = await ensureFixtures(page);
    test.skip(unit === null, "no unit available to trace");
    await page.goto(`/fr/quality/recall?unit=${unit}`, { waitUntil: "networkidle" });
    await check(page.getByRole("table", { name: /Lignée/ })).toBeVisible();
    await check(page.getByRole("link", { name: "Exporter en CSV" })).toHaveAttribute(
      "href",
      /\/api\/recall\?unitId=\d+&format=csv&locale=fr/
    );
    await check(page.getByRole("button", { name: "Imprimer le sommaire" })).toBeVisible();
  });

  test("destruction register: type filter and date range live in the URL", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/destroyed", { waitUntil: "networkidle", timeout: 40_000 });
    await page.getByRole("button", { name: /^Type/ }).click();
    await page.getByRole("menuitem", { name: "Plants", exact: true }).click();
    await check(page).toHaveURL(/type=PLANT/);
    await page.getByRole("textbox", { name: "Destroyed from", exact: true }).fill("2001-01-01");
    await page.getByRole("textbox", { name: "Destroyed to", exact: true }).fill("2001-01-31");
    await check(page).toHaveURL(/from=2001-01-01/);
    await check(page).toHaveURL(/type=PLANT/);
    await check(page.getByText("No destruction matches these filters")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await check(page).toHaveURL(/\/en\/inventory\/destroyed$/);
  });
});
