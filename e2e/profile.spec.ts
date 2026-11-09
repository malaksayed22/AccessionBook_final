import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("profile", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      for (const tab of ["general", "security", "sessions"] as const) {
        test(`${locale} ${colorScheme} ${tab}: no serious or critical accessibility violations`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme });
          await signIn(page, locale);
          await page.goto(`/${locale}/profile?tab=${tab}`, { waitUntil: "networkidle" });
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expect(page.getByRole("tab", { selected: true })).toBeVisible();
          await expectNoBlockingViolations(page);
        });
      }
    }
  }

  test("tabs work from the keyboard and the chosen tab stays in the URL", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/profile", { waitUntil: "networkidle" });
    const general = page.getByRole("tab", { name: "General" });
    await general.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Security" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page).toHaveURL(/tab=security/);
    await expect(page.getByRole("heading", { name: "Password", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page).not.toHaveURL(/tab=/);
    await page.goto("/en/profile?tab=bogus", { waitUntil: "networkidle" });
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("the summary card shows who is signed in and the two-step status", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/profile", { waitUntil: "networkidle" });
    const summary = page.getByRole("region", { name: "Account summary" });
    await expect(summary).toContainText("Administrator");
    await expect(summary).toContainText("Member since");
    await expect(summary).toContainText(/Two-step verification/);
    await expect(summary.getByText(/^(On|Off)$/)).toBeVisible();
  });

  test("forms ask for the missing password instead of sending anything", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/profile", { waitUntil: "networkidle" });
    let requests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/auth/profile")) requests += 1;
    });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter your current password to save changes.")).toBeVisible();

    await page.getByRole("tab", { name: "Security" }).click();
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Enter a new password.")).toBeVisible();
    await page.getByLabel(/^New password/).fill("a-long-enough-passphrase");
    await page.getByLabel(/^Confirm new password/).fill("something-else-entirely");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The new passwords do not match.")).toBeVisible();
    expect(requests).toBe(0);
  });

  test("sessions list this device and describe the browser", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/profile?tab=sessions", { waitUntil: "networkidle" });
    const list = page.getByRole("list", { name: "Sessions" });
    await expect(list.getByText("This device")).toHaveCount(1);
    await expect(list.getByText(/Chrome on|Unknown device|Chromium/).first()).toBeVisible();
    await expect(list.getByText(/Active .* ago|Active now|Active in/).first()).toBeVisible();
  });

  test("the French profile is fully translated", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/profile", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sécurité" })).toBeVisible();
    await expect(page.getByLabel("Nom d’utilisateur")).toBeVisible();
    await page.getByRole("tab", { name: "Sessions" }).click();
    await expect(page.getByText("Cet appareil")).toBeVisible();
  });
});
