import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

/** Opens one of the unit's menus (top right of the page: Records, Label, Actions) and returns it. */
async function openMenu(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the unit's Actions menu (top right of the page) and returns it. */
async function openActions(page: Page) {
  return openMenu(page, "Actions");
}

/*
 * The unit detail page, on a real unit read from the list (nothing is created for the read-only
 * checks). The action path derives one clone named E2E-<timestamp> from an existing plant, then
 * places and releases a hold on that clone; regulated rows are never deleted.
 */
test.describe("unit detail", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  /** The first unit in a list; `free` skips units on hold, which cannot be derived from. */
  async function firstUnitPath(page: Page, query = "", free = false): Promise<string | null> {
    await page.goto(`/en/inventory/units${query}`, { waitUntil: "networkidle" });
    const rows = free
      ? page.locator("table tbody tr").filter({ hasNotText: /hold/i })
      : page.locator("table tbody tr");
    const link = rows.locator('th a[href*="/inventory/units/"]').first();
    if ((await link.count()) === 0) return null;
    const href = await link.getAttribute("href");
    return href ? href.replace(/^\/(en|fr)/, "") : null;
  }

  const TABS = {
    en: ["Overview", "History", "Lineage", "Quality", "Documents"],
    fr: ["Aperçu", "Historique", "Filiation", "Qualité", "Documents"],
  } as const;

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`${locale} ${colorScheme}: every tab passes the accessibility check`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.emulateMedia({ colorScheme });
        await signIn(page, "en");
        const path = await firstUnitPath(page);
        test.skip(path === null, "no units in the development database");

        await page.goto(`/${locale}${path}`, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        for (const label of TABS[locale]) {
          await page.getByRole("tab", { name: new RegExp(`^${label}`) }).click();
          await expect(page.getByRole("tab", { name: new RegExp(`^${label}`) })).toHaveAttribute(
            "aria-selected",
            "true"
          );
          await expectNoBlockingViolations(page);
        }
      });
    }
  }

  test("tabs work from the keyboard and the chosen tab is kept in the URL", async ({ page }) => {
    await signIn(page, "en");
    const path = await firstUnitPath(page);
    test.skip(path === null, "no units in the development database");

    await page.goto(`/en${path}`, { waitUntil: "networkidle" });
    const overview = page.getByRole("tab", { name: /^Overview/ });
    await overview.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /^History/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page).toHaveURL(/tab=history/);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("tab", { name: /^History/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // Who / what / when: every history row names a person and carries a time zone.
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first().locator("time").first()).toContainText(/[A-Z]{3,4}|GMT/);
  });

  test("the profile layout: Records, Label and Actions menus, edit on the card, timelines first", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await signIn(page, "en");
    const path = await firstUnitPath(page, "?status=active&type=PLANT", true);
    test.skip(path === null, "no active plant in the development database");

    await page.goto(`/en${path}`, { waitUntil: "networkidle" });
    const menu = await openActions(page);
    test.skip(
      (await menu.getByRole("menuitem", { name: "Move to another location" }).count()) === 0,
      "this account cannot act on that plant"
    );

    // The forms are in the Actions menu; the label and the records have their own menus beside it.
    // Lab results and samples are set aside for now.
    await expect(page.getByRole("region", { name: "Actions" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Print label" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Recall trace" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Record a lab result" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Take a sample" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Add weight" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Add notes" })).toBeVisible();
    await page.keyboard.press("Escape");
    // The label is one button that prints it; there is no label PDF.
    await expect(page.getByRole("button", { name: "Print label" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Label PDF" })).toHaveCount(0);
    const records = await openMenu(page, "Records");
    await expect(records.getByRole("menuitem", { name: "Recall trace" })).toBeVisible();
    await expect(records.getByRole("menuitem", { name: "Audit report" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Unit label" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Print QR code only" })).toHaveCount(0);

    // Weights are always on the card: the dry weight as weighed, and what is left of it.
    await expect(page.getByText("Wet weight", { exact: true })).toBeVisible();
    await expect(page.getByText("Original dry weight", { exact: true })).toBeVisible();
    await expect(page.getByText("Remaining dry weight", { exact: true })).toBeVisible();
    // The facts card has no title or description; the timelines come before it.
    await expect(page.getByText("Key facts")).toHaveCount(0);
    const headings = await page.getByRole("tabpanel").getByRole("heading").allTextContents();
    expect(headings.indexOf("Stage timing")).toBeLessThan(
      headings.indexOf("Source and provenance")
    );

    // The card has its own Edit (sex and stage); the notes keep only notes.
    await expect(
      page.getByRole("tabpanel").getByRole("button", { name: "Add notes" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const details = page.getByRole("dialog", { name: "Edit sex and stage" });
    await expect(details.getByLabel("Sex")).toBeVisible();
    await expect(details.getByLabel("Stage")).toBeVisible();
    await expectNoBlockingViolations(page);
    await page.keyboard.press("Escape");

    // Stage timing is one bar with the stage dates under it.
    await expect(page.getByRole("heading", { name: "Stage timing" })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Stage timeline:/ })).toBeVisible();

    // The Quality tab shows no lab results for now.
    await page.getByRole("tab", { name: /^Quality/ }).click();
    await expect(page.getByRole("heading", { name: "Lab results" })).toHaveCount(0);

    // Lineage has no experiments section, and no activity can be recorded.
    await page.getByRole("tab", { name: /^Lineage/ }).click();
    await expect(page.getByRole("heading", { name: "Experiments" })).toHaveCount(0);
    await page.getByRole("tab", { name: /^Documents/ }).click();
    await expect(page.getByRole("button", { name: /Record an activity/ })).toHaveCount(0);
  });

  test("linking a parent searches as you type", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "en");
    const path = await firstUnitPath(page, "?status=active&type=PLANT", true);
    test.skip(path === null, "no active plant in the development database");
    await page.goto(`/en${path}`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: /^Lineage/ }).click();
    // The lineage panel has its own button (the Actions menu has one too).
    const link = page.getByRole("tabpanel").getByRole("button", { name: "Link a parent unit" });
    test.skip((await link.count()) === 0, "this plant already has a parent, or cannot be edited");
    await link.click();
    const dialog = page.getByRole("dialog", { name: "Link a parent unit" });
    const box = dialog.getByRole("combobox");
    await box.click();
    await box.fill("E");
    await expect(dialog.getByText("Type at least two letters").first()).toBeVisible();
    await box.fill("EXP");
    await expect(dialog.getByRole("option").nth(1)).toBeVisible({ timeout: 20_000 });
    await expectNoBlockingViolations(page);
    await page.keyboard.press("Escape");
  });

  test("derived units can go into a new experiment", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "en");
    const path = await firstUnitPath(page, "?status=active&type=PLANT", true);
    test.skip(path === null, "no active plant to derive from");
    await page.goto(`/en${path}`, { waitUntil: "networkidle" });
    const deriveItem = (await openActions(page)).getByRole("menuitem", {
      name: "Derive clones or cultures",
    });
    test.skip((await deriveItem.count()) === 0, "this account cannot act on that plant");

    await deriveItem.click();
    const derive = page.getByRole("dialog", { name: "Derive new units" });
    const create = derive.getByRole("button", { name: "Create" });
    await derive.getByLabel(/^Experiment/).selectOption("new");
    // A new experiment needs a name before anything is created.
    await expect(create).toBeDisabled();
    const experimentName = `E2E-derived-${Date.now()}`;
    await derive.getByLabel("New experiment name").fill(experimentName);
    await expect(create).toBeEnabled();
    await derive.getByLabel("Name (optional)").fill(`${experimentName}-U`);
    await create.click();
    await expect(derive).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(/in new experiment EXP\d+/).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.goto("/en/inventory/experiments?q=" + experimentName, { waitUntil: "networkidle" });
    await expect(page.getByText(experimentName).first()).toBeVisible();
  });

  test("the French page is fully translated", async ({ page }) => {
    await signIn(page, "fr");
    const path = await firstUnitPath(page);
    test.skip(path === null, "no units in the development database");
    await page.goto(`/fr${path}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("tab", { name: /^Aperçu/ })).toBeVisible();
    await expect(page.getByText("Key facts")).toHaveCount(0);
    const records = await openMenu(page, "Dossiers");
    await expect(records.getByRole("menuitem", { name: "Rapport d’audit" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Imprimer l’étiquette" })).toBeVisible();
  });

  test("the unit record downloads as a PDF in the page's language", async ({ page }) => {
    await signIn(page, "fr");
    const path = await firstUnitPath(page);
    test.skip(path === null, "no units in the development database");
    await page.goto(`/fr${path}`, { waitUntil: "networkidle" });

    const item = (await openMenu(page, "Dossiers")).getByRole("menuitem", {
      name: "Fiche de l’unité (PDF)",
    });
    await expect(item).toHaveAttribute("href", /^\/api\/units\/\d+\/record\?locale=fr$/);
    const [download] = await Promise.all([page.waitForEvent("download"), item.click()]);
    expect(download.suggestedFilename()).toMatch(/^unit-record-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  test("shipping a unit: all of it, or a part whose material must be chosen", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "en");
    const path = await firstUnitPath(page, "?status=active&type=FLOWER", true);
    test.skip(path === null, "no active flower in the development database");
    const unitId = path!.split("/").pop();
    await page.goto(`/en/inventory/materials/new?unit=${unitId}`, { waitUntil: "networkidle" });

    // Ship all or ship part is chosen once, above the material lines.
    const shipAll = page.getByRole("radio", { name: /^Ship all/ });
    await expect(shipAll).toBeChecked();
    const line = page.getByRole("listitem", { name: "Line 1" });
    await expect(line.getByRole("radio")).toHaveCount(0);
    // All of the unit: the line says what leaves, with no fields to fill, and nothing can be added.
    await expect(line.getByText("What leaves")).toBeVisible();
    await expect(line.getByLabel(/^Material/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a different kind of part" })).toHaveCount(0);
    // The cultivar of a shipped line is the unit's: there is nothing to choose.
    await expect(line.getByLabel(/^Cultivar/)).toHaveCount(0);

    await page.getByRole("radio", { name: /^Ship part/ }).check();
    const material = line.getByLabel(/^Material/);
    await expect(material).toBeEnabled();
    await expect(material).toHaveValue("");
    // Seeds are counted, not weighed.
    await material.selectOption("SEED");
    await expect(line.getByLabel(/^Count/)).toBeVisible();
    await expect(line.getByLabel(/^Weight/)).toHaveCount(0);

    // Another part of the same unit needs its own material; the same material again is fine.
    await page.getByRole("button", { name: "Add a different kind of part" }).click();
    const second = page.getByRole("listitem", { name: "Line 2" });
    await expect(second.getByLabel(/^Material/)).toHaveValue("");
    await second.getByLabel(/^Material/).selectOption("SEED");

    // Back to all: the unit keeps one line.
    await shipAll.check();
    await expect(page.getByRole("listitem", { name: "Line 2" })).toHaveCount(0);

    // Switching to receiving and back drops the shipped lines: each unit is picked again, so no
    // line is left without its unit.
    await page.getByRole("radio", { name: "Receiving material" }).check();
    await page.getByRole("radio", { name: "Shipping material" }).check();
    await expect(page.getByRole("listitem", { name: "Line 1" })).toHaveCount(0);
    await expectNoBlockingViolations(page);
  });

  test("the move dialog opens from the menu and closes with Escape, returning focus", async ({
    page,
  }) => {
    await signIn(page, "en");
    const path = await firstUnitPath(page, "?status=active");
    test.skip(path === null, "no active units in the development database");

    await page.goto(`/en${path}`, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", { name: "Actions", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const move = page.getByRole("menu").getByRole("menuitem", { name: "Move to another location" });
    test.skip((await move.count()) === 0, "this account cannot act on that unit");
    test.skip(
      (await move.getAttribute("aria-disabled")) === "true",
      "unit is on hold, so it cannot be moved"
    );
    await move.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Move unit" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Record move" })).toBeDisabled();
    await expectNoBlockingViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("derive a clone, place it on hold, then release the hold with a reason", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, "en");
    const parentPath = await firstUnitPath(page, "?status=active&type=PLANT", true);
    test.skip(parentPath === null, "no active plant to derive from");

    const name = `E2E-${Date.now()}`;
    await page.goto(`/en${parentPath}`, { waitUntil: "networkidle" });
    const deriveItem = (await openActions(page)).getByRole("menuitem", {
      name: "Derive clones or cultures",
    });
    test.skip((await deriveItem.count()) === 0, "this account cannot act on that plant");

    // Derive through the dialog; the clone carries a name this test owns.
    await deriveItem.click();
    const derive = page.getByRole("dialog", { name: "Derive new units" });
    // The new units stay in the same experiment unless another one is chosen.
    await expect(derive.getByLabel(/^Experiment/)).toContainText(/Same experiment/);
    await derive.getByLabel("Name (optional)").fill(name);
    await derive.getByRole("button", { name: "Create" }).click();
    await expect(derive).toBeHidden({ timeout: 20_000 });

    await page.getByRole("tab", { name: /^Lineage/ }).click();
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    // Place a hold with a reason.
    await (
      await openActions(page)
    )
      .getByRole("menuitem", { name: "Place on quality hold" })
      .click();
    const hold = page.getByRole("dialog", { name: "Place on quality hold" });
    const place = hold.getByRole("button", { name: "Place on hold" });
    await expect(place).toBeDisabled();
    await hold.getByLabel(/^Reason/).fill("E2E check: suspected contamination");
    await place.click();
    await expect(hold).toBeHidden({ timeout: 20_000 });

    const banner = page.getByRole("alert").filter({ hasText: "Quality Hold in effect" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("E2E check: suspected contamination");
    await expect(banner).toContainText("cannot be moved");

    // A hold blocks moving the unit: the item stays in the menu, disabled, and says why.
    const move = (await openActions(page)).getByRole("menuitem", {
      name: "Move to another location",
    });
    await expect(move).toHaveAttribute("aria-disabled", "true");
    await expect(move).toHaveAccessibleDescription("On hold");
    await page.keyboard.press("Escape");

    // Release it with the keyboard: the confirm button stays disabled until the reason is long enough.
    const release = page.getByRole("dialog", { name: /Release the hold on/ });
    // The banner re-renders after the hold is placed, so the first Enter can land before it is ready.
    await expect(async () => {
      await banner.getByRole("button", { name: "Release quality hold" }).focus();
      await page.keyboard.press("Enter");
      await expect(release).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    const confirm = release.getByRole("button", { name: "Release hold" });
    await expect(confirm).toBeDisabled();
    await release.getByLabel(/^Reason/).fill("short");
    await expect(confirm).toBeDisabled();
    await release.getByLabel(/^Reason/).fill("E2E check: cleared by inspection");
    await expect(confirm).toBeEnabled();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await confirm.click();
    await expect(release).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole("alert").filter({ hasText: "in effect" })).toHaveCount(0);

    // Both the placing and the release are in the history with who did them.
    await page.getByRole("tab", { name: /^History/ }).click();
    const history = page.getByRole("table", { name: "History of this unit" });
    await expect(history).toContainText("Hold placed");
    await expect(history).toContainText("Hold released");
    await expect(history).toContainText("E2E check: cleared by inspection");
    await expectNoBlockingViolations(page);
  });
});
