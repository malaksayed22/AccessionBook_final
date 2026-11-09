import { expect, test } from "@playwright/test";
import { e2eCredentials } from "./helpers";

test("health endpoint answers without touching the database", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("readiness endpoint confirms the database answers, and leaks nothing", async ({ request }) => {
  const response = await request.get("/api/ready");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ready" });
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/en/login");
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await expect(page.getByLabel(/e-mail or name/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test("two-step verification is offered after sign-in and can be skipped", async ({ page }) => {
  const credentials = e2eCredentials();
  test.skip(!credentials, "needs E2E_USER / E2E_PASSWORD or a local dev admin");
  await page.goto("/en/login");
  await page.getByLabel(/e-mail or name/i).fill(credentials!.name);
  await page.getByLabel(/password/i).fill(credentials!.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  const skip = page.getByRole("button", { name: "Skip for now" });
  const code = page.getByLabel("Verification code");
  await expect(skip.or(code).first()).toBeVisible({ timeout: 30_000 });
  test.skip(await code.isVisible(), "this account already has two-step verification");
  await expect(page.getByText(/It is optional/)).toBeVisible();
  await skip.click();
  await expect(page).toHaveURL(/\/en\/dashboard/, { timeout: 30_000 });
});

test("private pages redirect anonymous visitors to sign in", async ({ page }) => {
  await page.goto("/en/records/members");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Frecords%2Fmembers/);
});

test("anonymous API calls are refused", async ({ request }) => {
  const response = await request.get("/api/units/1/ledger");
  expect(response.status()).toBe(401);
});
