import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

type Locale = "en" | "fr";

const WORDS = {
  en: {
    next: "Next",
    back: "Back",
    create: "Create experiment",
    removeUnits: /^Remove unit/,
    addGroup: /Add a unit group/,
    stepAria: "Steps",
    created: /Experiment created/,
    edit: "Edit",
    save: "Save changes",
    updated: "Experiment updated",
    noMatch: "No experiments match these filters",
    notFound: "Page not found",
    running: "Running",
    table: "Table",
    nameLabel: /Experiment name/,
    nameRequired: "Enter a name for the experiment.",
  },
  fr: {
    next: "Suivant",
    back: "Précédent",
    create: "Créer l’expérience",
    removeUnits: /^Retirer (l’unité|le groupe d’unités)/,
    addGroup: /Ajouter un groupe d’unités/,
    stepAria: "Étapes",
    created: /Expérience créée/,
    edit: "Modifier",
    save: "Enregistrer les modifications",
    updated: "Expérience mise à jour",
    noMatch: "Aucune expérience ne correspond à ces filtres",
    notFound: "Page introuvable",
    running: "En cours",
    table: "Tableau",
    nameLabel: /Nom de l’expérience/,
    nameRequired: "Saisissez un nom pour l’expérience.",
  },
} as const;

/**
 * Creates (once per worker) an experiment named E2E-<timestamp> through the API, so the detail page
 * has something to show whatever the shared development database holds. Regulated rows are never
 * deleted, which is why the name makes the leftovers recognisable.
 */
let createdId: number | null = null;
async function ensureExperiment(page: Page): Promise<number> {
  if (createdId) return createdId;
  const today = new Date().toISOString().slice(0, 10);
  const response = await page.request.post("/api/experiments", {
    data: { name: `E2E-${Date.now()}`, startDate: today, providerMode: "INTERNAL" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as { id: number };
  createdId = body.id;
  return createdId;
}

const step = (page: Page, locale: Locale) =>
  page.getByRole("navigation", { name: WORDS[locale].stepAria }).locator('[aria-current="step"]');

/** The units step opens with one single unit; removing every unit and group leaves it empty. */
async function clearUnits(page: Page, locale: Locale) {
  const remove = page.getByRole("button", { name: WORDS[locale].removeUnits });
  while ((await remove.count()) > 0) await remove.first().click();
}

async function openWizard(page: Page, locale: Locale) {
  await page.goto(`/${locale}/inventory/experiments/new`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel(WORDS[locale].nameLabel)).toBeVisible();
}

test.describe("experiments", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      const label = `${locale} ${colorScheme}`;

      test(`${label}: list has no serious or critical accessibility violations`, async ({
        page,
      }) => {
        // A full page of cards, each with three bars, is a large tree for axe to walk.
        test.slow();
        await page.emulateMedia({ colorScheme });
        await signIn(page, locale);
        await ensureExperiment(page);
        await page.goto(`/${locale}/inventory/experiments`, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoBlockingViolations(page);
        await page.goto(`/${locale}/inventory/experiments?view=table`, {
          waitUntil: "networkidle",
        });
        await expect(page.getByRole("table")).toBeVisible();
        await expectNoBlockingViolations(page);
      });

      test(`${label}: detail page has no serious or critical accessibility violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await signIn(page, locale);
        const id = await ensureExperiment(page);
        await page.goto(`/${locale}/inventory/experiments/${id}`, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E-");
        await expectNoBlockingViolations(page);
      });

      test(`${label}: every wizard step has no serious or critical accessibility violations`, async ({
        page,
      }) => {
        const words = WORDS[locale];
        await page.emulateMedia({ colorScheme });
        await signIn(page, locale);
        await openWizard(page, locale);

        // Step 1, then the same step showing its errors.
        await expectNoBlockingViolations(page);
        await page.getByRole("button", { name: words.next, exact: true }).click();
        await expect(page.getByText(words.nameRequired)).toBeVisible();
        await expectNoBlockingViolations(page);

        // Step 2: the default single unit, a unit group beside it, their errors, then both removed.
        await page.getByLabel(words.nameLabel).fill(`E2E-a11y-${Date.now()}`);
        await page.getByRole("button", { name: words.next, exact: true }).click();
        await expect(step(page, locale)).toContainText(/2/);
        await expectNoBlockingViolations(page);
        await page.getByRole("button", { name: words.addGroup }).click();
        await expectNoBlockingViolations(page);
        await page.getByRole("button", { name: words.next, exact: true }).click();
        await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
        await expectNoBlockingViolations(page);
        await clearUnits(page, locale);

        // Steps 3 and 4.
        await page.getByRole("button", { name: words.next, exact: true }).click();
        await expect(step(page, locale)).toContainText(/3/);
        await expectNoBlockingViolations(page);
        await page.getByRole("button", { name: words.next, exact: true }).click();
        await expect(step(page, locale)).toContainText(/4/);
        await expectNoBlockingViolations(page);
      });
    }
  }

  test("search, status and membership filters live in the URL and keep the language", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await ensureExperiment(page);
    await page.goto("/fr/inventory/experiments", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /^Statut/ }).click();
    await page.getByRole("menuitem", { name: WORDS.fr.running }).click();
    await expect(page).toHaveURL(/\/fr\/inventory\/experiments\?.*status=running/, {
      timeout: 20_000,
    });

    await page.getByRole("link", { name: "Mes expériences" }).click();
    await expect(page).toHaveURL(/mine=1/, { timeout: 20_000 });

    await page.getByRole("searchbox").fill("zzz-no-such-experiment");
    await expect(page).toHaveURL(/q=zzz-no-such-experiment/, { timeout: 20_000 });
    await expect(page.getByText(WORDS.fr.noMatch)).toBeVisible();

    await page.getByRole("link", { name: "Effacer les filtres" }).first().click();
    await expect(page).toHaveURL(/\/fr\/inventory\/experiments$/, { timeout: 20_000 });
  });

  test("the view toggle switches between cards and a sortable table", async ({ page }) => {
    await signIn(page, "en");
    await ensureExperiment(page);
    await page.goto("/en/inventory/experiments", { waitUntil: "networkidle" });
    await expect(page.getByRole("list", { name: "Experiments" })).toBeVisible();

    await page.getByRole("link", { name: WORDS.en.table }).click();
    await expect(page).toHaveURL(/view=table/, { timeout: 20_000 });
    await expect(page.getByRole("table")).toBeVisible();
    const header = page.getByRole("columnheader", { name: /Name/ });
    await header.getByRole("link").click();
    await expect(page).toHaveURL(/sort=name/, { timeout: 20_000 });
    await expect(page.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      /ascending|descending/
    );
    await expect(page.getByRole("link", { name: WORDS.en.table })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  test("search treats % as a character, not a wildcard", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/experiments?q=%25zz", { waitUntil: "networkidle" });
    await expect(page.getByText(WORDS.en.noMatch)).toBeVisible();
  });

  test("an unknown or malformed experiment address is a not-found page, not an error", async ({
    page,
  }) => {
    await signIn(page, "en");
    for (const path of [
      "/en/inventory/experiments/999999999",
      "/en/inventory/experiments/99999999999",
      "/en/inventory/experiments/abc",
      "/en/inventory/experiments/999999999/labels",
    ]) {
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: WORDS.en.notFound }), path).toBeVisible();
    }
  });

  test("the wizard moves with the keyboard, checks each step and keeps its place", async ({
    page,
  }) => {
    const words = WORDS.en;
    await signIn(page, "en");
    await openWizard(page, "en");
    await expect(step(page, "en")).toContainText("Experiment");

    // Enter in the name field tries to move on: the empty name is refused and focused.
    await page.getByLabel(words.nameLabel).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(words.nameRequired)).toBeVisible();
    await expect(page.getByLabel(words.nameLabel)).toBeFocused();

    // A name, then Enter again: step 2, and focus moves to the step heading.
    await page.keyboard.type("E2E-keyboard");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: /Step 2 of 4/ })).toBeFocused();

    // The step opens with one single unit. Without a cultivar it is refused and the field is focused.
    await expect(page.getByText("Unit 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: words.next, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();

    // Back with the keyboard keeps what was typed.
    await page.getByRole("button", { name: words.back, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(words.nameLabel)).toHaveValue("E2E-keyboard");

    // A reload restores the unfinished form from the session draft.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("Draft restored")).toBeVisible();
    await expect(page.getByLabel(words.nameLabel)).toHaveValue("E2E-keyboard");
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByLabel(words.nameLabel)).toHaveValue("");
  });

  test("creates an experiment with starting units, a location and an internal source", async ({
    page,
  }) => {
    test.slow();
    await signIn(page, "en");
    await openWizard(page, "en");
    const name = `E2E-units-${Date.now()}`;
    await page.getByLabel(WORDS.en.nameLabel).fill(name);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // The default single unit has no quantity; a group does. Replace the unit by a group of two plants.
    await clearUnits(page, "en");
    await page.getByRole("button", { name: /Add a unit group/ }).click();

    const cultivar = page.getByLabel(/^Cultivar/).first();
    const cultivars = await cultivar.locator("option").count();
    test.skip(cultivars < 2, "the development database has no cultivar to register units with");
    await cultivar.selectOption({ index: 1 });
    await page.getByLabel(/Number of plants/).fill("2");
    // The starting status is required and has no default: Next is refused until one is chosen.
    const status = page.getByLabel(/Status of all units/);
    await expect(status).toHaveValue("");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Choose the status shared by all units.")).toBeVisible();
    await status.selectOption({ index: 1 });
    await expect(page.getByText(/2 units will be created/)).toBeVisible();
    await expectNoBlockingViolations(page);
    await page.getByRole("button", { name: "Next", exact: true }).click();

    const location = page.getByLabel(/^Location/);
    const locations = await location.locator("option").count();
    test.skip(locations < 2, "the development database has no active location");
    await location.selectOption({ index: 1 });
    await page
      .getByLabel(/Describe the internal source/)
      .fill("Internal stock for the end-to-end test");
    await expectNoBlockingViolations(page);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Inbound receipt and files" })).toBeVisible();
    await expectNoBlockingViolations(page);

    const create = page.getByRole("button", { name: "Create experiment", exact: true });
    await create.click();
    // Earlier runs leave units in the chosen room; the capacity guard then asks for an override.
    const override = page.getByRole("checkbox", { name: /Create anyway/ });
    if (await override.isVisible({ timeout: 3000 }).catch(() => false)) {
      await override.check();
      await create.click();
    }
    await expect(page).toHaveURL(/\/en\/inventory\/experiments\/\d+\?created=1/, {
      timeout: 40_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByRole("link", { name: "Print their labels" })).toBeVisible();
    await page.getByRole("link", { name: "Print labels" }).first().click();
    await expect(page.getByText("2 labels")).toBeVisible({ timeout: 20_000 });
    await expectNoBlockingViolations(page);
  });

  test("the new experiment form has no code, takes an estimated end date, starts with one single unit and searches parents", async ({
    page,
  }) => {
    await signIn(page, "en");
    await openWizard(page, "en");
    await expect(page.getByLabel(/Code prefix|Experiment code|^End date/i)).toHaveCount(0);
    await expect(page.getByLabel("Start date")).toBeVisible();
    await expect(page.getByLabel("Estimated end date")).toBeVisible();

    // The parent list is a drop-down you can type into, by code or by name.
    const parent = page.getByRole("combobox", { name: "Sub-experiment of" });
    await parent.click();
    await expect(page.getByRole("option", { name: /^None/ })).toBeVisible();
    await ensureExperiment(page);
    await parent.fill("E2E-");
    const matches = page.getByRole("option").filter({ hasText: "E2E-" });
    await expect(matches.first()).toBeVisible();
    await parent.fill("zzz-no-such-experiment");
    await expect(page.getByText("No experiment matches.")).toBeVisible();
    await parent.fill("E2E-");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(parent).toHaveValue(/E2E-/);

    await page.getByLabel(/Experiment name/).fill("E2E-search-parent");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // One single unit by default: no quantity. "Add a unit group" adds a group, which has one.
    await expect(page.getByText("Unit 1", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Number of/)).toHaveCount(0);
    await page.getByRole("button", { name: /Add a unit group/ }).click();
    await expect(page.getByLabel(/Number of/)).toHaveCount(1);
    await clearUnits(page, "en");
    await expect(page.getByText("No starting units")).toBeVisible();
    await expect(page.getByRole("button", { name: /Add a unit group/ })).toBeVisible();
  });

  test("the review step takes files, and they are attached to the new experiment", async ({
    page,
  }) => {
    test.slow();
    await signIn(page, "en");
    await openWizard(page, "en");
    const name = `E2E-files-${Date.now()}`;
    await page.getByLabel(/Experiment name/).fill(name);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await clearUnits(page, "en");
    for (let i = 0; i < 2; i += 1) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Inbound receipt and files" })).toBeVisible();
    await page.getByLabel("Attach files").setInputFiles({
      name: "protocol.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Spray at dawn.\n"),
    });
    await expect(page.getByText("protocol.txt")).toBeVisible();
    await expectNoBlockingViolations(page);

    await page.getByRole("button", { name: "Create experiment", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/inventory\/experiments\/\d+\?created=1/, {
      timeout: 40_000,
    });
    // The side sections are tabs: the documents are one of them.
    await page.getByRole("tab", { name: /^Documents/ }).click();
    await expect(page.getByText("protocol.txt").first()).toBeVisible({ timeout: 20_000 });
  });

  test("an experiment shows its unit status, unit types and stage timeline bars", async ({
    page,
  }) => {
    await signIn(page, "en");
    const id = await ensureExperiment(page);
    await page.goto("/en/inventory/experiments", { waitUntil: "networkidle" });
    await expect(page.getByText("Unit status").first()).toBeVisible();
    await expect(page.getByText("Unit types").first()).toBeVisible();
    await expect(page.getByText("Stage timeline").first()).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await page.goto(`/en/inventory/experiments/${id}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Unit status").first()).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    // Stage timeline first, then unit types, then unit status; no number cards above them.
    const order = await page
      .locator("main")
      .getByText(/^(Stage timeline|Unit types|Unit status)$/)
      .allTextContents();
    expect(order.slice(0, 3)).toEqual(["Stage timeline", "Unit types", "Unit status"]);
    await expect(page.getByRole("region", { name: /statistics|Unit counts/i })).toHaveCount(0);
    // The side sections are tabs; the activity's full log is this experiment's own log.
    await expect(page.getByRole("tab", { name: /^Tasks/ })).toBeVisible();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    const fullLog = page.getByRole("link", { name: "Full log" });
    if ((await fullLog.count()) > 0) {
      await expect(fullLog).toHaveAttribute(
        "href",
        new RegExp(`/inventory/experiments/${id}/log$`)
      );
      await fullLog.click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Log of");
    }
    await expectNoBlockingViolations(page);
  });

  test("the experiment record downloads as a PDF, and only for an experiment one can see", async ({
    page,
  }) => {
    await signIn(page, "en");
    const id = await ensureExperiment(page);
    await page.goto(`/en/inventory/experiments/${id}`, { waitUntil: "networkidle" });

    const link = page.getByRole("link", { name: "Experiment record (PDF)" });
    await expect(link).toHaveAttribute("href", `/api/experiments/${id}/record?locale=en`);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^experiment-record-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const missing = await page.request.get("/api/experiments/99999999/record");
    expect(missing.status()).toBe(404);
  });

  test("an administrator can add a member and edit the dates, and the estimate is optional", async ({
    page,
  }) => {
    test.slow();
    await signIn(page, "en");
    const today = new Date().toISOString().slice(0, 10);
    const response = await page.request.post("/api/experiments", {
      data: { name: `E2E-admin-${Date.now()}`, startDate: today, providerMode: "INTERNAL" },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const { id } = (await response.json()) as { id: number };

    await page.goto(`/en/inventory/experiments/${id}`, { waitUntil: "networkidle" });
    // The team is one of the side tabs.
    await page.getByRole("tab", { name: /^Team/ }).click();
    await expect(page.getByText("Add a member")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Start date")).toBeEnabled();
    const estimate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Estimated end date").fill(estimate);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Experiment updated").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Estimated end").first()).toBeVisible();
  });

  test("completing an experiment records its end date, and an administrator can reopen it", async ({
    page,
  }) => {
    test.slow();
    await signIn(page, "en");
    // An experiment cannot be completed before it started or in the future, in the lab's time zone.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.LAB_TIMEZONE ?? "America/Toronto",
    }).format(new Date());
    const response = await page.request.post("/api/experiments", {
      data: { name: `E2E-complete-${Date.now()}`, startDate: today, providerMode: "INTERNAL" },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const { id } = (await response.json()) as { id: number };

    await page.goto(`/en/inventory/experiments/${id}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Running").first()).toBeVisible();
    await page.getByRole("button", { name: "Mark as completed" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete this experiment?" });
    await expect(dialog).toBeVisible();
    await expectNoBlockingViolations(page);
    await dialog.getByRole("button", { name: "Complete experiment" }).click();
    await expect(page.getByText("Experiment completed").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await expect(page.getByText("Completed").first()).toBeVisible();

    await page.getByRole("button", { name: "Reopen" }).click();
    await page.getByRole("button", { name: "Reopen experiment" }).click();
    await expect(page.getByText("Experiment reopened").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Mark as completed" })).toBeVisible({
      timeout: 20_000,
    });
  });

  for (const locale of ["en", "fr"] as const) {
    test(`${locale}: creates an experiment, then edits it and reads its record`, async ({
      page,
    }) => {
      test.slow();
      const words = WORDS[locale];
      const name = `E2E-${Date.now()}-${locale}`;
      await signIn(page, locale);
      await openWizard(page, locale);

      await page.getByLabel(words.nameLabel).fill(name);
      await page.getByRole("button", { name: words.next, exact: true }).click();
      // No starting units: the step is optional, so remove the default unit.
      await clearUnits(page, locale);
      await page.getByRole("button", { name: words.next, exact: true }).click();
      await page.getByRole("button", { name: words.next, exact: true }).click();
      await expect(page.getByText(name).first()).toBeVisible();

      await page.getByRole("button", { name: words.create }).click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/inventory/experiments/\\d+\\?created=1`),
        {
          timeout: 30_000,
        }
      );
      await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
      await expect(page.getByText(words.created).first()).toBeVisible();

      await page.getByRole("button", { name: words.edit }).click();
      await page.getByLabel(/Notes|Notes et protocole/).fill("Written by the end-to-end test");
      await page.getByRole("button", { name: words.save }).click();
      await expect(page.getByText(words.updated).first()).toBeVisible();
      await expect(page.getByText("Written by the end-to-end test")).toBeVisible({
        timeout: 20_000,
      });

      const id = page.url().match(/experiments\/(\d+)/)?.[1];
      await page.goto(`/${locale}/inventory/experiments/${id}/labels`, {
        waitUntil: "networkidle",
      });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoBlockingViolations(page);
    });
  }
});
