import { expect, test } from "@playwright/test";
import { e2eCredentials, signIn } from "./helpers";

test.describe("table tools on the experiments and shipments lists", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("the experiments table hides a column, and the view is saved", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/experiments?view=table", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Team" }).click();
    await expect(page).toHaveURL(/hide=team/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /^Team/ })).toHaveCount(0);

    const name = `Table ${Date.now()}`;
    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("menuitem", { name: "Save this view…" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  });

  test("the shipments list hides a column from its menu", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/materials", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Tracking" }).click();
    await expect(page).toHaveURL(/hide=tracking/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Columns (1 hidden)" })).toBeVisible();
  });
});
