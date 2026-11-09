import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("dashboard (administrator)", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`${locale} ${colorScheme}: passes the accessibility check`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await signIn(page, locale);
        await page.goto(`/${locale}/dashboard`, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expectNoBlockingViolations(page);
      });
    }
  }

  test("opens with the inventory summary and the administrator's whole-laboratory view", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/en/dashboard", { waitUntil: "networkidle" });
    await expect(page.getByText("Administrator view")).toBeVisible();

    // The summary is the first section after the page title.
    const sections = page.locator("main section");
    await expect(
      sections.first().getByRole("heading", { name: "Inventory summary" })
    ).toBeVisible();
    // The summary is charts, each saying what it counts; no cards repeating them.
    for (const title of [
      "Units by status",
      "Units by type",
      "Units by stage",
      "Units by location",
    ]) {
      await expect(sections.first().getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(sections.first().getByRole("link", { name: /^Active units/ })).toHaveCount(0);
    // The type, stage and location donuts count types, stages and locations in their centre.
    await expect(sections.first().getByText(/^types?$/)).toBeVisible();
    await expect(sections.first().getByText(/^stages?$/)).toBeVisible();
    await expect(sections.first().getByText(/^locations?$/)).toBeVisible();

    // Administrators also see every member; nothing about lab results, activity or trends.
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Lab results|Trends|^Activity$/ })).toHaveCount(
      0
    );
    await expect(page.getByText(/failed lab test/i)).toHaveCount(0);
    // The dashboard has no compliance findings card.
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Next best step/ })).toHaveCount(0);
  });

  test("a status on the chart opens the units list with that status", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/dashboard", { waitUntil: "networkidle" });
    await page
      .locator("main section")
      .first()
      .getByRole("link", { name: /^Active/ })
      .click();
    await expect(page).toHaveURL(/\/en\/inventory\/units\?status=active/);
  });

  test("the French dashboard is translated", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/dashboard", { waitUntil: "networkidle" });
    await expect(page.getByText("Vue administrateur")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Résumé de l’inventaire" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Membres" })).toBeVisible();
  });
});
