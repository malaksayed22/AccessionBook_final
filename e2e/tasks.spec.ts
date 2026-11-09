import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("tasks", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  for (const locale of ["en", "fr"] as const) {
    test(`${locale}: the list and the calendar pass the accessibility check`, async ({ page }) => {
      await signIn(page, locale);
      await page.goto(`/${locale}/inventory/tasks`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoBlockingViolations(page);
      await page.goto(`/${locale}/inventory/tasks?display=calendar`, { waitUntil: "networkidle" });
      await expect(page.locator("table").first()).toBeVisible();
      await expectNoBlockingViolations(page);
    });
  }

  test("plans a task, shows it on its day and marks it done", async ({ page }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/tasks", { waitUntil: "networkidle" });
    const title = `E2E task ${Date.now()}`;

    await page.getByRole("button", { name: "New task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Plan a task" });
    await dialog.getByLabel("What is to be done").fill(title);
    // Given to nobody yet, so it shows under everyone's tasks.
    await dialog.getByRole("button", { name: "Plan task" }).click();
    await expect(dialog).toBeHidden();

    // An administrator starts on everyone's tasks; their own are one choice away.
    await expect(page).not.toHaveURL(/view=/);
    await expect(page.getByRole("button", { name: /^Whose/ })).toContainText("Everyone's");
    const row = page.getByRole("row", { name: new RegExp(title) });
    await expect(row).toBeVisible();

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/display=calendar/);
    await expect(page.locator("td li", { hasText: title })).toBeVisible();

    await page.getByRole("link", { name: "List" }).click();
    await page
      .getByRole("row", { name: new RegExp(title) })
      .getByRole("button", { name: "Done" })
      .click();
    await expect(page.getByText(`“${title}” done`).first()).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(title) })).toHaveCount(0);
  });
});
