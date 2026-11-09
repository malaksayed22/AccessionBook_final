import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("units list", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`${locale} ${colorScheme}: no serious or critical accessibility violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await signIn(page, locale);
        await page.goto(`/${locale}/inventory/units`, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoBlockingViolations(page);
      });
    }
  }

  test("filters, search and sort live in the URL and keep the language", async ({ page }) => {
    // Many page loads against a development database that e2e runs keep filling.
    test.slow();
    await signIn(page, "fr");
    await page.goto("/fr/inventory/units", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /^Statut/ }).click();
    await page.getByRole("menuitem", { name: "En retenue", exact: true }).click();
    await expect(page).toHaveURL(/\/fr\/inventory\/units\?.*status=hold/);

    await page.getByRole("searchbox").fill("zzz-no-such-unit");
    await expect(page).toHaveURL(/q=zzz-no-such-unit/);
    await expect(page.getByText("Aucune unité ne correspond à ces filtres")).toBeVisible();

    await page.getByRole("link", { name: "Effacer les filtres" }).click();
    await expect(page).toHaveURL(/\/fr\/inventory\/units$/);
    const sortLink = page.getByRole("columnheader", { name: /Unité/ }).getByRole("link");
    await sortLink.click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByRole("columnheader", { name: /Unité/ })).toHaveAttribute(
      "aria-sort",
      /ascending|descending/
    );
  });

  test("one status donut, no cards: a status opens the matching list and toggles off again", async ({
    page,
  }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/units", { waitUntil: "networkidle" });
    const chart = page.getByRole("region", { name: "Units by status" });
    await expect(chart.getByRole("heading", { name: "Units by status" })).toBeVisible();
    await expect(page.getByText("In stock, not on hold")).toHaveCount(0);

    await chart.getByRole("link", { name: /^Active/ }).click();
    await expect(page).toHaveURL(/status=active/);
    await page
      .getByRole("region", { name: "Units by status" })
      .getByRole("link", { name: /^Active/ })
      .click();
    await expect(page).not.toHaveURL(/status=/);
  });

  test("the status chart is translated", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/inventory/units", { waitUntil: "networkidle" });
    const chart = page.getByRole("region", { name: "Unités par statut" });
    await expect(chart.getByRole("heading", { name: "Unités par statut" })).toBeVisible();
    await expect(chart.getByRole("link", { name: /^Active/ })).toBeVisible();
  });

  test("hides columns, groups rows, exports chosen rows and saves the view", async ({ page }) => {
    test.slow();
    await signIn(page, "en");
    await page.goto("/en/inventory/units", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Cultivar" }).click();
    await expect(page).toHaveURL(/hide=cultivar/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /^Cultivar/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Columns (1 hidden)" })).toBeVisible();

    await page.getByLabel("Group by").selectOption("location");
    await expect(page).toHaveURL(/group=location/);
    await expect(page.locator("tbody th[scope=colgroup]").first()).toBeVisible();

    const rowBoxes = page.getByRole("checkbox", { name: /^Select (?!all)/ });
    await rowBoxes.nth(0).check();
    await rowBoxes.nth(1).check();
    await expect(page.getByRole("link", { name: "Export selected (CSV)" })).toHaveAttribute(
      "href",
      /^\/api\/units\/export\?ids=\d+,\d+$/
    );
    await page.getByRole("button", { name: "Clear selection" }).click();

    const name = `Grouped ${Date.now()}`;
    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("menuitem", { name: "Save this view…" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();

    // Back on the plain list, the saved view brings the columns and grouping back.
    await page.goto("/en/inventory/units", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    await expect(page).toHaveURL(/group=location/);
    await expect(page).toHaveURL(/hide=cultivar/);
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("menuitem", { name: `Delete “${name}”` }).click();
    await expect(page.getByRole("button", { name: "Saved views" })).toBeVisible();
  });

  test("search treats % as a character, not a wildcard", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/units?q=%25", { waitUntil: "networkidle" });
    await expect(page.getByText("No units match these filters")).toBeVisible();
  });
});
