import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("notification centre", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("the bell opens the newest notices and the page lists them all", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "en");
    await page.goto("/en/dashboard", { waitUntil: "networkidle" });
    const bell = page.getByRole("button", { name: /^Notifications/ }).first();
    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "See all notifications" })).toBeVisible();
    await expectNoBlockingViolations(page);
    await panel.getByRole("link", { name: "See all notifications" }).click();
    await expect(page).toHaveURL(/\/en\/notifications/);
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expectNoBlockingViolations(page);
  });
});
