import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/**
 * The accessibility gate every rebuilt page must pass, in both languages and both themes:
 * zero serious or critical axe violations against WCAG 2.2 AA. Pass `include` to scope to a region.
 */
export async function expectNoBlockingViolations(page: Page, include: string[] = []) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of include) builder = builder.include(selector);
  const { violations } = await builder.analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(blocking, "accessibility violations").toEqual([]);
}
