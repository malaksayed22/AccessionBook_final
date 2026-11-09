import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * The developer gallery (/{locale}/dev/ui) renders every design-system primitive. These tests scan
 * it with axe (WCAG 2.2 AA) in both languages and both themes, and exercise the interactive
 * behaviours that matter most: dialog focus handling, tabs, the type-to-confirm gate and URL-driven
 * sorting.
 *
 * The gallery is a dev tool outside the signed-in layout. The proxy only checks that a session
 * cookie exists (it never validates it), so a placeholder value is enough to reach the page.
 */
const SESSION_COOKIE = "accessionbook_session";
/** Navigations re-render a 130-row server page; the dev server can be slow under load. */
const NAV = { timeout: 20_000 };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type ThemeMode = {
  name: string;
  media: "light" | "dark";
  /** Forced theme through the `ab_theme` cookie; undefined follows the media query. */
  cookie?: "light" | "dark";
};

const THEME_MODES: ThemeMode[] = [
  { name: "light (media)", media: "light" },
  { name: "dark (media)", media: "dark" },
  { name: "light (cookie, OS dark)", media: "dark", cookie: "light" },
  { name: "dark (cookie, OS light)", media: "light", cookie: "dark" },
];

async function prepare(context: BrowserContext, page: Page, mode: ThemeMode) {
  const url = "http://localhost:" + (process.env.E2E_PORT ?? "3100");
  await context.addCookies([
    { name: SESSION_COOKIE, value: "e2e-ui-gallery", url },
    ...(mode.cookie ? [{ name: "ab_theme", value: mode.cookie, url }] : []),
  ]);
  await page.emulateMedia({ colorScheme: mode.media, reducedMotion: "reduce" });
}

function collectCspViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy|refused to (apply|execute|load|connect)/i.test(text)) {
      violations.push(text);
    }
  });
  page.on("pageerror", (error) => violations.push(error.message));
  return violations;
}

async function gotoGallery(page: Page, locale: "en" | "fr", search = "") {
  await page.goto(`/${locale}/dev/ui${search}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "UI gallery" })).toBeVisible();
}

test.describe.configure({ timeout: 120_000 });

test.describe("accessibility scan of the gallery", () => {
  for (const locale of ["en", "fr"] as const) {
    for (const mode of THEME_MODES) {
      test(`/${locale}/dev/ui has no serious or critical axe violations, ${mode.name}`, async ({
        page,
        context,
      }) => {
        await prepare(context, page, mode);
        const csp = collectCspViolations(page);
        await gotoGallery(page, locale);

        const expectedTheme = mode.cookie ?? undefined;
        const attribute = await page.locator("html").getAttribute("data-theme");
        expect(attribute ?? undefined).toBe(expectedTheme);

        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const blocking = results.violations.filter(
          (violation) => violation.impact === "serious" || violation.impact === "critical"
        );
        expect(
          blocking.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
          }))
        ).toEqual([]);
        expect(csp).toEqual([]);
      });
    }
  }

  test("an open confirm dialog has no serious or critical violations", async ({
    page,
    context,
  }) => {
    await prepare(context, page, { name: "dark", media: "dark" });
    await gotoGallery(page, "en");
    await page.getByRole("button", { name: "Void record…" }).first().click();
    await expect(page.getByRole("dialog", { name: "Void unit U-0042?" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical"
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });
});

test.describe("interactions", () => {
  test.beforeEach(async ({ context, page }) => {
    await prepare(context, page, { name: "light", media: "light" });
  });

  test("Dialog traps focus, closes on Escape and returns focus to its trigger", async ({
    page,
  }) => {
    await gotoGallery(page, "en");
    const trigger = page.getByRole("button", { name: "Open dialog" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Example dialog" });
    await expect(dialog).toBeVisible();

    for (let press = 0; press < 8; press++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]'))
      );
      expect(inside, `focus escaped the dialog after ${press + 1} Tab presses`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("Dialog close button is labelled and closes it", async ({ page }) => {
    await gotoGallery(page, "en");
    await page.getByRole("button", { name: "Open dialog" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("Tabs move with ArrowRight", async ({ page }) => {
    await gotoGallery(page, "en");
    const first = page.getByRole("tab", { name: "Overview" });
    const second = page.getByRole("tab", { name: "History" });
    await first.focus();
    await expect(first).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowRight");
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("History panel");
  });

  test("ConfirmDialog keeps confirm disabled until reason and phrase are given", async ({
    page,
  }) => {
    await gotoGallery(page, "en");
    await page.getByRole("button", { name: "Void record…" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Void unit U-0042?" });
    const confirm = dialog.getByRole("button", { name: "Void unit" });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel(/^Reason/).fill("Contaminated during transfer");
    await expect(confirm).toBeDisabled();

    const phrase = dialog.getByLabel(/^Type .*VOID.* to confirm/);
    await phrase.fill("VOI");
    await expect(confirm).toBeDisabled();
    await phrase.fill("void");
    await expect(confirm).toBeDisabled();
    await phrase.fill("VOID");
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Unit voided").first()).toBeVisible();
  });

  test("ConfirmDialog shows an error when the action fails and stays open", async ({ page }) => {
    await gotoGallery(page, "en");
    await page.getByRole("button", { name: "Release hold (fails)" }).click();
    const dialog = page.getByRole("dialog", { name: "Release hold?" });
    await dialog.getByRole("button", { name: "Release hold" }).click();
    await expect(dialog.getByRole("alert")).toContainText("could not be completed");
    await expect(dialog).toBeVisible();
  });

  test("SortHeader link toggles aria-sort and the URL", async ({ page }) => {
    await gotoGallery(page, "en");
    const table = page.getByRole("table", { name: "Units in custody" });
    const header = table.getByRole("columnheader", { name: /^Code/ });
    await expect(header).not.toHaveAttribute("aria-sort", /.+/);

    await header.getByRole("link").click();
    await expect(page).toHaveURL(/sort=code&order=asc/, NAV);
    await expect(header).toHaveAttribute("aria-sort", "ascending");

    await header.getByRole("link").click();
    await expect(page).toHaveURL(/sort=code&order=desc/, NAV);
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect(table.getByRole("rowheader").first()).toHaveText("U-0130");
  });

  test("Pagination and filter chips are driven by the URL", async ({ page }) => {
    await gotoGallery(page, "en");
    await expect(page.getByText("1–10 of 130")).toBeVisible();

    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/, NAV);
    await expect(page.getByText("11–20 of 130")).toBeVisible();
    await expect(page.getByRole("link", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.getByRole("button", { name: /^Filter by status/ }).click();
    await page.getByRole("menuitem", { name: /^On hold/ }).click();
    await expect(page).toHaveURL(/status=on-hold/, NAV);
    // The chosen option is named on the trigger and marked in the list.
    const trigger = page.getByRole("button", { name: /^Filter by status.*On hold/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: /^On hold/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    await page.getByRole("menuitem", { name: "Clear all" }).click();
    await expect(page).not.toHaveURL(/status=/, NAV);
  });

  test("French build translates the component text", async ({ page }) => {
    await gotoGallery(page, "fr");
    await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Suivant" })).toBeVisible();
    await expect(page.getByText("1–10 sur 130")).toBeVisible();
    await page.getByRole("button", { name: "Open dialog" }).click();
    await expect(page.getByRole("button", { name: "Fermer", exact: true })).toBeVisible();
  });

  test("Toast announces politely and can be dismissed", async ({ page }) => {
    await gotoGallery(page, "en");
    await page.getByRole("button", { name: "Show success toast" }).click();
    const toast = page.getByRole("status").filter({ hasText: "Saved" }).first();
    await expect(toast).toBeVisible();
    await expect(page.getByRole("region", { name: /Notifications/ })).toBeAttached();
  });

  test("no CSP violations while using dialogs, menus and toasts", async ({ page }) => {
    const csp = collectCspViolations(page);
    await gotoGallery(page, "en");
    await page.getByRole("button", { name: "Open dialog" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Row actions" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show success toast" }).click();
    await expect(page.getByText("Your changes were recorded.").first()).toBeVisible();
    expect(csp).toEqual([]);
  });
});
