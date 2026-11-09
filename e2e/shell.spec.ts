import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { e2eCredentials, signIn } from "./helpers";

const AA = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function blockingViolations(page: import("@playwright/test").Page, include?: string[]) {
  let builder = new AxeBuilder({ page }).withTags(AA);
  for (const selector of include ?? []) builder = builder.include(selector);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe("sign-in page", () => {
  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`${locale} ${colorScheme}: no serious or critical accessibility violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(`/${locale}/login`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        expect(await blockingViolations(page)).toEqual([]);
      });
    }
  }

  test("the language switch keeps the page and switches the copy", async ({ page }) => {
    await page.goto("/en/login");
    await page.getByRole("button", { name: /Français/ }).click();
    await expect(page).toHaveURL(/\/fr\/login/);
    await expect(page.getByRole("heading", { name: "Bon retour" })).toBeVisible();
    await expect(page.getByLabel("Courriel ou nom")).toBeVisible();
  });

  test("a wrong password shows a translated, non-revealing message", async ({ page }) => {
    await page.goto("/fr/login");
    await page.getByLabel("Courriel ou nom").fill("personne");
    await page.getByLabel("Mot de passe").fill("incorrect-incorrect");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(
      page.getByText("Ce courriel, ce nom ou ce mot de passe n’est pas valide.")
    ).toBeVisible();
  });

  test("the first visit negotiates the language from Accept-Language", async ({ browser }) => {
    const context = await browser.newContext({
      locale: "fr-CA",
      extraHTTPHeaders: { "Accept-Language": "fr-CA,fr;q=0.9" },
    });
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page).toHaveURL(/\/fr\/login/);
    await context.close();
  });
});

test.describe("application shell", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("the sidebar lists every page, marks the current one and keeps its place", async ({
    page,
  }) => {
    await signIn(page);
    const nav = page.getByRole("navigation", { name: "Main navigation" }).first();
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    for (const name of ["Units", "Experiments", "Recall trace", "Members", "Reports"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }

    await nav.getByRole("link", { name: "Experiments" }).click();
    await expect(page).toHaveURL(/\/en\/inventory\/experiments/);
    await expect(nav.getByRole("link", { name: "Experiments" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  test("a record page keeps its hub and shows real breadcrumbs", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/inventory/units");
    const first = page.locator('table tbody th a[href*="/inventory/units/"]').first();
    const name = (await first.textContent())?.trim() ?? "";
    await first.click();
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Inventory" })).toBeVisible({ timeout: 30_000 });
    await expect(crumbs.getByRole("link", { name: "Units" })).toBeVisible();
    await expect(crumbs.getByText(name)).toHaveAttribute("aria-current", "page");
  });

  test("old top-level addresses forward to their hub, keeping the query", async ({ page }) => {
    // Each address compiles its target page the first time in development.
    test.slow();
    await signIn(page);
    const moved: Array<[string, RegExp]> = [
      ["/en/units?status=active", /\/en\/inventory\/units\?status=active$/],
      ["/en/qa", /\/en\/quality$/],
      ["/en/recall", /\/en\/quality\/recall$/],
      ["/en/overview", /\/en\/compliance\/reports$/],
      ["/en/activity", /\/en\/compliance\/audit$/],
      ["/en/inventory", /\/en\/inventory\/units$/],
      ["/en/records", /\/en\/records\/cultivars$/],
    ];
    for (const [from, to] of moved) {
      await page.goto(from);
      await expect(page).toHaveURL(to, { timeout: 20_000 });
    }
  });

  test("navigation links keep the language prefix", async ({ page }) => {
    await signIn(page, "fr");
    await expect(page.getByRole("heading", { name: "Inventaire", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Unités" }).first().click();
    await expect(page).toHaveURL(/\/fr\/inventory\/units/);
    await expect(page.getByRole("link", { name: "Unités" }).first()).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("the skip link moves focus to the main region", async ({ page }) => {
    await signIn(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("Ctrl+K opens the palette, filters pages, opens one with Enter and closes with Escape", async ({
    page,
  }) => {
    await signIn(page);
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Command palette" });
    await expect(box).toBeFocused();
    await box.fill("destroyed");
    await expect(page.getByRole("option", { name: /Destroyed/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/inventory\/destroyed/);

    await page.keyboard.press("Control+k");
    await expect(page.getByRole("combobox", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Command palette" })).toBeHidden();
  });

  test("the account block links to the profile page", async ({ page }) => {
    await signIn(page);
    await page.getByRole("link", { name: /Open the profile of/ }).click();
    await expect(page).toHaveURL(/\/en\/profile/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("the theme choice persists in a cookie and is applied on the server", async ({ page }) => {
    await signIn(page);
    // One button flips between light and dark; the first click pins the opposite of what is shown.
    const toggle = page.getByRole("button", { name: "Colour theme" });
    const html = page.locator("html");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", /^(light|dark)$/);
    const chosen = (await html.getAttribute("data-theme"))!;
    await toggle.click();
    const flipped = chosen === "dark" ? "light" : "dark";
    await expect(html).toHaveAttribute("data-theme", flipped);
    const served = await (await page.request.get("/en/dashboard")).text();
    expect(served).toMatch(new RegExp(`<html[^>]*data-theme="${flipped}"`));
  });

  test("mobile: the drawer opens, traps focus and closes with Escape", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, baseURL });
    const page = await context.newPage();
    await signIn(page);
    const opener = page.getByRole("button", { name: "Open navigation" });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link", { name: "Units", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await context.close();
  });

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`${locale} ${colorScheme}: the shell has no serious or critical violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await signIn(page, locale);
        expect(await blockingViolations(page, ["aside", "nav"])).toEqual([]);
      });
    }
  }

  test("the profile page is accessible in both languages", async ({ page }) => {
    await signIn(page);
    for (const locale of ["en", "fr"]) {
      await page.goto(`/${locale}/profile`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await blockingViolations(page)).toEqual([]);
    }
  });
});
