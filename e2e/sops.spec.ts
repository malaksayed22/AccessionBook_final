import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("procedures", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  for (const locale of ["en", "fr"] as const) {
    test(`${locale}: the procedures list passes the accessibility check`, async ({ page }) => {
      await signIn(page, locale);
      await page.goto(`/${locale}/quality/sops`, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoBlockingViolations(page);
    });
  }

  test("writes a procedure, approves it and signs it as read", async ({ page }) => {
    // A fresh sign-in (not the cached session), so approving and signing do not ask for the
    // password again: both are electronic signatures that need a recent sign-in.
    await signIn(page, "en", { fresh: true });
    await page.goto("/en/quality/sops", { waitUntil: "networkidle" });
    const code = `E2E-${Date.now().toString().slice(-8)}`;

    await page.getByRole("button", { name: "New procedure" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Write a procedure" });
    await dialog.getByLabel("Code").fill(code);
    await dialog.getByLabel("Title").fill("Weighing dried flower");
    await dialog
      .getByLabel("Procedure", { exact: false })
      .fill("1. Tare the scale.\n2. Weigh the flower.\n3. Record the weight in the unit.");
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/en\/quality\/sops\/\d+$/);
    await expect(page.getByText("No version is in effect yet")).toBeVisible();

    await page.getByRole("button", { name: "Attach document" }).click();
    const attach = page.getByRole("dialog", { name: "Attach the document of version 1" });
    await attach.getByLabel("Document").setInputFiles({
      name: `${code}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"),
    });
    await attach.getByRole("button", { name: "Attach", exact: true }).click();
    await expect(attach).toBeHidden();
    await expect(page.getByRole("link", { name: `${code}.pdf (50 B)` })).toHaveAttribute(
      "href",
      /\/api\/sops\/\d+\/versions\/1\/file$/
    );

    await page.getByRole("button", { name: "Approve version 1" }).click();
    await page.getByRole("button", { name: "Approve and put in effect" }).click();
    await expect(page.getByText("Please read version 1 and sign it.")).toBeVisible();
    await expectNoBlockingViolations(page);

    await page.getByRole("button", { name: "Sign version 1" }).click();
    await page.getByRole("button", { name: "I have read and understood it" }).click();
    await expect(page.getByText(/You signed version 1 on/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign version 1" })).toHaveCount(0);
  });
});
