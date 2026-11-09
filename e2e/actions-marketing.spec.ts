import { expect, test, type Page } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

type Locale = "en" | "fr";
const LOCALES: Locale[] = ["en", "fr"];
const SCHEMES = ["light", "dark"] as const;

const COPY = {
  en: {
    h1: "Every lineage.",
    cta: "Start with an empty workspace",
    signIn: "Sign in",
    take: "Take action",
    register: "Register units",
    registered: /registered/,
    description: /system of record for genetic material/,
  },
  fr: {
    h1: "Chaque lignée.",
    cta: "Commencez avec un espace de travail vide",
    signIn: "Se connecter",
    take: "Passer à l’action",
    register: "Enregistrer des unités",
    registered: /enregistrée/,
    description: /système de référence du matériel génétique/,
  },
} as const;

/** Scrolls the whole page once, so every fade-in block has had its turn before a11y checks run. */
async function revealEverything(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);
}

test.describe("marketing page (anonymous)", () => {
  // The first request of a route compiles it in the dev server, which can take a while.
  test.describe.configure({ timeout: 90_000 });

  for (const locale of LOCALES) {
    for (const colorScheme of SCHEMES) {
      test(`${locale} ${colorScheme}: no serious or critical accessibility violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(`/${locale}`, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toContainText(COPY[locale].h1);
        await revealEverything(page);
        await expectNoBlockingViolations(page);
      });
    }
  }

  for (const locale of LOCALES) {
    test(`${locale}: landmarks, one h1, translated metadata and sign-in link`, async ({ page }) => {
      await page.goto(`/${locale}`, { waitUntil: "networkidle" });

      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      // Headings never skip a level inside the page body.
      const levels = await page
        .locator("main h1, main h2, main h3")
        .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));
      levels.reduce((previous, level) => {
        expect(level - previous, "heading levels do not jump").toBeLessThanOrEqual(1);
        return level;
      }, 0);

      await expect(page).toHaveTitle(new RegExp(COPY[locale].h1.replace(".", "")));
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        COPY[locale].description
      );
      await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
        "content",
        locale === "fr" ? "fr_CA" : "en_CA"
      );
      await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
      await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(2);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);

      await expect(
        page.getByRole("banner").getByRole("link", { name: COPY[locale].signIn })
      ).toHaveAttribute("href", `/${locale}/login`);
      // No horizontal scrolling at any width the layout supports.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("the language switch and theme toggle are visible and work", async ({ page }) => {
    await page.goto("/en", { waitUntil: "networkidle" });
    const banner = page.getByRole("banner");
    const language = banner.getByRole("button", { name: "Language" });
    await expect(language).toBeVisible();
    // The first click can land before React has attached the handler in a cold dev build.
    const french = page.getByRole("menuitem", { name: "Français" });
    await expect(async () => {
      if (!(await french.isVisible())) await language.click();
      await expect(french).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await french.click();
    // The first visit to /fr compiles the page in a dev build, which can take several seconds.
    await expect(page).toHaveURL(/\/fr$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(COPY.fr.h1);

    const toggle = banner.getByRole("button", { name: /theme|thème/i });
    await expect(toggle).toBeVisible();
    const before = await page.locator("html").getAttribute("data-theme");
    await toggle.click();
    await expect.poll(() => page.locator("html").getAttribute("data-theme")).not.toBe(before);
  });

  test("the pillar tabs follow the keyboard pattern", async ({ page }) => {
    await page.goto("/en", { waitUntil: "networkidle" });
    const first = page.getByRole("tab", { name: /Lineage that survives the question/ });
    await first.scrollIntoViewIfNeeded();
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("tab", { name: /Holds that actually hold/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByRole("tabpanel", { name: /Holds that actually hold/ })).toContainText(
      "SMP-1039"
    );
  });

  test("with reduced motion everything is visible at once and nothing animates", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en", { waitUntil: "networkidle" });

    // The last block of the page is visible without scrolling to it.
    const cta = page.getByRole("heading", { name: COPY.en.cta });
    await expect(cta).toBeVisible();
    const opacity = await cta.evaluate((node) => {
      let element: Element | null = node;
      let value = 1;
      while (element) {
        value *= Number(getComputedStyle(element).opacity);
        element = element.parentElement;
      }
      return value;
    });
    expect(opacity).toBe(1);

    await page.waitForTimeout(500);
    const running = await page.evaluate(
      () => document.getAnimations().filter((animation) => animation.playState === "running").length
    );
    expect(running, "no animation is running").toBe(0);
  });

  test("with motion allowed, blocks below the fold fade in when reached", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/en", { waitUntil: "networkidle" });
    const heading = page.getByRole("heading", { name: "Built to be inspected" });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
    // Reached on scroll, it settles at full strength.
    await expect
      .poll(() =>
        heading.evaluate((node) => {
          let element: Element | null = node;
          let value = 1;
          while (element) {
            value *= Number(getComputedStyle(element).opacity);
            element = element.parentElement;
          }
          return value;
        })
      )
      .toBe(1);
  });
});

test.describe("register units from the units page (signed in)", () => {
  test.describe.configure({ timeout: 90_000 });
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  async function open(page: Page, locale: Locale) {
    await signIn(page, locale);
    await page.goto(`/${locale}/inventory/units`, { waitUntil: "networkidle" });
    // There is no floating "Take action" button any more: the page has its own.
    await expect(page.getByRole("button", { name: COPY[locale].take })).toHaveCount(0);
    const launcher = page.getByRole("button", { name: COPY[locale].register, exact: true });
    await launcher.click();
    const dialog = page.getByRole("dialog", { name: COPY[locale].register });
    await expect(dialog).toBeVisible();
    // The form opens straight away once the picker data has loaded.
    await expect(dialog.getByRole("heading", { level: 3 })).toBeVisible({ timeout: 20_000 });
    return { launcher, dialog };
  }

  for (const locale of LOCALES) {
    for (const colorScheme of SCHEMES) {
      test(`${locale} ${colorScheme}: the open dialog has no serious or critical violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        const { dialog } = await open(page, locale);
        await expectNoBlockingViolations(page);

        void dialog;
      });
    }
  }

  test("focus is trapped, Escape closes and focus returns to the button", async ({ page }) => {
    const { launcher, dialog } = await open(page, "en");

    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null
      );
      expect(inside, `focus stays in the dialog after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(launcher).toBeFocused();
  });

  test("a form shows field errors and sends nothing until it is valid", async ({ page }) => {
    const { dialog } = await open(page, "en");
    let posted = false;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/units")) posted = true;
    });

    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("This field is required.").first()).toBeVisible();
    await expect(dialog.getByText(/Step 1 of 2/)).toBeVisible();
    expect(posted).toBe(false);
  });

  test("registers a unit in a throwaway experiment, in French", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "fr");
    const stamp = Date.now();
    const experimentName = `E2E-${stamp}`;
    const unitName = `E2E-${stamp}-U`;

    const bootstrap = await (await page.request.get("/api/actions/bootstrap")).json();
    test.skip(
      bootstrap.cultivars.length === 0 || bootstrap.locations.length === 0,
      "the development database has no cultivar or location to register against"
    );

    const today = new Date().toISOString().slice(0, 10);
    const created = await page.request.post("/api/experiments", {
      data: { name: experimentName, startDate: today, providerMode: "INTERNAL" },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { id: experimentId } = (await created.json()) as { id: number };

    await page.goto("/fr/inventory/units", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: COPY.fr.register, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: COPY.fr.register });

    // Step 1: material.
    await dialog.getByLabel(/^Expérience/).selectOption(String(experimentId));
    await dialog.getByLabel(/^Nom/).fill(unitName);
    await dialog.getByLabel(/^Cultivar/).selectOption({ index: 1 });
    await dialog.getByLabel(/^Emplacement/).selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Continuer" }).click();

    // Step 2: origin, then send.
    await expect(dialog.getByText(/Étape 2 de 2/)).toBeVisible();
    await dialog
      .getByLabel(/^Détails sur la source/)
      .fill("Stock interne créé pour un test automatisé de bout en bout");
    await dialog.getByRole("button", { name: "Enregistrer les unités" }).click();

    await expect(dialog.getByRole("heading", { name: COPY.fr.registered })).toBeVisible({
      timeout: 20_000,
    });
    await expect(dialog.getByRole("heading", { name: new RegExp(unitName) })).toBeVisible();

    // The unit exists and the list finds it.
    await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
    await page.goto(`/fr/inventory/units?q=${encodeURIComponent(unitName)}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await expect(page.getByRole("link", { name: unitName })).toBeVisible();
  });
});
