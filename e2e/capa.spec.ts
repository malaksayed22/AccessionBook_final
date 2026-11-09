import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("corrective and preventive actions", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("an incident's page raises an action, records it done and checks it", async ({ page }) => {
    test.slow();
    await signIn(page, "en");
    await page.goto("/en/quality", { waitUntil: "networkidle", timeout: 40_000 });
    const title = `E2E deviation ${Date.now()}`;

    await page.getByRole("button", { name: "Open an incident" }).click();
    const opening = page.getByRole("dialog");
    await opening.getByRole("textbox", { name: /^Title/ }).fill(title);
    await opening
      .getByRole("textbox", { name: /^What happened/ })
      .fill("Weighed on an uncalibrated scale.");
    await opening.getByRole("button", { name: "Open incident" }).click();
    await expect(opening).toBeHidden();

    await page.goto(`/en/quality?view=incidents&q=${encodeURIComponent(title)}`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("link", { name: title }).click();
    // The incident page's first visit compiles it on the development server.
    await expect(page).toHaveURL(/\/en\/quality\/incidents\/\d+$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({
      timeout: 30_000,
    });
    await expectNoBlockingViolations(page);
    // Quality assurance can name the procedure the incident departed from.
    await expect(page.getByLabel("Procedure departed from")).toHaveValue("");

    await page.getByRole("button", { name: "Add an action" }).click();
    const adding = page.getByRole("dialog", { name: "Add a corrective or preventive action" });
    await adding.getByLabel("What is to be done").fill("Recalibrate the scale");
    await adding.getByRole("button", { name: "Add action" }).click();
    await expect(adding).toBeHidden();
    await expect(page.getByText(/still to be done/)).toBeVisible();

    await page.getByRole("button", { name: "Record as done" }).click();
    const done = page.getByRole("dialog", { name: "Record the action as done" });
    await done.getByLabel("What was done").fill("Calibrated with the 100 g weight");
    await done.getByRole("button", { name: "Record as done" }).click();
    await expect(page.getByText(/Done by .+ on .+:/)).toBeVisible();

    await page.getByRole("button", { name: "Check it worked" }).click();
    const check = page.getByRole("dialog", { name: "Check that the action worked" });
    await check.getByLabel("How you checked").fill("Within 0.01 g for a week");
    await check.getByRole("button", { name: "Record the check" }).click();
    await expect(page.getByText(/Checked by .+ on .+:/)).toBeVisible();
    await expect(page.getByText(/still to be done/)).toHaveCount(0);
  });
});
