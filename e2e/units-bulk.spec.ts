import { expect, test } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

test.describe("bulk actions on units", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("select several units, see what an action will touch, and apply it to all of them", async ({
    page,
  }) => {
    test.slow();
    await signIn(page, "en");
    await page.goto("/en/inventory/units?status=active&type=PLANT&q=E2E", {
      waitUntil: "networkidle",
    });
    const rowBoxes = page.getByRole("checkbox", { name: /^Select (?!all)/ });
    test.skip((await rowBoxes.count()) < 2, "needs two active plants in the development database");

    // Nothing is selected, so there is no action bar.
    await expect(page.getByRole("region", { name: "Actions for the selected units" })).toHaveCount(
      0
    );
    await rowBoxes.nth(0).check();
    await rowBoxes.nth(1).check();
    const bar = page.getByRole("region", { name: "Actions for the selected units" });
    await expect(bar.getByText("2 units selected")).toBeVisible();

    // The header checkbox selects the whole page, and clearing empties the selection.
    await page.getByRole("checkbox", { name: "Select all units on this page" }).check();
    const all = await rowBoxes.count();
    await expect(bar.getByText(`${all} units selected`)).toBeVisible();
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(bar).toHaveCount(0);

    await rowBoxes.nth(0).check();
    await rowBoxes.nth(1).check();

    // Destruction is irreversible: it needs a reason, and no witness or typed number is asked for.
    await bar.getByRole("button", { name: "Record destruction" }).click();
    const destroy = page.getByRole("dialog", { name: /Record the destruction of 2 units/ });
    await expect(destroy.getByRole("button", { name: "Record destruction" })).toBeDisabled();
    await expect(destroy.getByLabel(/Witness/)).toHaveCount(0);
    await expect(destroy.getByLabel(/Type/)).toHaveCount(0);
    await destroy.getByLabel(/^Reason for destruction/).fill("Checking the form only");
    await expect(destroy.getByRole("button", { name: "Record destruction" })).toBeEnabled();
    await expectNoBlockingViolations(page);
    await page.keyboard.press("Escape");
    await expect(destroy).toBeHidden();

    // Move both units: the form leaves out any unit already in the chosen room.
    await bar.getByRole("button", { name: "Move", exact: true }).click();
    const move = page.getByRole("dialog", { name: /^Move \d+ units?$/ });
    await expect(move.getByRole("button", { name: "Move units" })).toBeDisabled();
    const destination = move.getByLabel(/^New location/);
    const options = await destination
      .locator("option")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean)
      );
    // Try the rooms in turn: skip a room that already holds both units, and move on from one that is
    // full (the form then names the unit that stopped it and nothing changes).
    let moved = false;
    for (const value of options) {
      await destination.selectOption(value);
      if (!(await move.getByText("2 of 2 selected units will be updated.").isVisible())) continue;
      await move.getByRole("button", { name: "Move units" }).click();
      const outcome = page.getByText("2 units moved").first().or(move.getByRole("alert"));
      await expect(outcome).toBeVisible({ timeout: 30_000 });
      if (await page.getByText("2 units moved").first().isVisible()) {
        moved = true;
        break;
      }
      await expect(move.getByRole("alert")).toContainText("Nothing was changed");
    }
    test.skip(!moved, "no room could take both units");
    await expectNoBlockingViolations(page);
    // The selection is cleared once the action is done.
    await expect(bar).toHaveCount(0, { timeout: 20_000 });
  });

  test("record one pesticide application on several units, with its PCP registration number", async ({
    page,
  }) => {
    await signIn(page, "en");
    await page.goto("/en/inventory/units?status=active&type=PLANT", { waitUntil: "networkidle" });
    const rowBoxes = page.getByRole("checkbox", { name: /^Select (?!all)/ });
    test.skip((await rowBoxes.count()) < 2, "needs two active plants");
    await rowBoxes.nth(0).check();
    await rowBoxes.nth(1).check();

    const bar = page.getByRole("region", { name: "Actions for the selected units" });
    await bar.getByRole("button", { name: "Record an activity" }).click();
    const dialog = page.getByRole("dialog", { name: "Record an activity on 2 units" });
    const submit = dialog.getByRole("button", { name: "Record activity" });

    // A pesticide is the default, and it cannot be logged without its product, number and amount.
    await expect(dialog.getByLabel(/^Kind of activity/)).toHaveValue("PESTICIDE");
    await dialog.getByLabel(/^What was done/).fill("Foliar spray against powdery mildew");
    await dialog.getByLabel(/^Product or species/).fill("Neem oil 70%");
    await expect(submit).toBeDisabled();
    await dialog.getByLabel(/^PCP registration number/).fill("30500");
    await dialog.getByLabel(/^Amount used/).fill("2.5");
    await expect(submit).toBeDisabled();
    await dialog.getByLabel(/^Unit/).fill("L");
    await expect(submit).toBeEnabled();
    await expectNoBlockingViolations(page);

    // Scouting needs no product or registration number.
    await dialog.getByLabel(/^Kind of activity/).selectOption("SCOUTING");
    await expect(dialog.getByLabel(/^PCP registration number/)).toHaveCount(0);
    await dialog.getByLabel(/^Kind of activity/).selectOption("PESTICIDE");

    await submit.click();
    await expect(page.getByText("Activity recorded on 2 units").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(bar).toHaveCount(0, { timeout: 20_000 });
  });

  test("the move form lets an administrator add a location and selects it", async ({ page }) => {
    test.slow();
    await signIn(page, "en");
    await page.goto("/en/inventory/units?status=active&type=PLANT&q=E2E", {
      waitUntil: "networkidle",
    });
    const rowBoxes = page.getByRole("checkbox", { name: /^Select (?!all)/ });
    test.skip((await rowBoxes.count()) < 1, "needs an active plant in the development database");
    await rowBoxes.nth(0).check();
    await page
      .getByRole("region", { name: "Actions for the selected units" })
      .getByRole("button", { name: "Move", exact: true })
      .click();
    const move = page.getByRole("dialog", { name: /^Move \d+ units?$/ });
    await move.getByRole("button", { name: "Add a new location" }).click();
    const name = `E2E-room-${Date.now()}`;
    await move.getByLabel("Location name").fill(name);
    await expectNoBlockingViolations(page);
    await move.getByRole("button", { name: "Add location" }).click();
    // The new room is in the list and already chosen.
    await expect(move.getByLabel(/^New location/)).toHaveValue(/\d+/, { timeout: 20_000 });
    await expect(move.getByLabel(/^New location/).locator("option:checked")).toHaveText(name);
    await expect(move.getByRole("button", { name: "Move units" })).toBeEnabled();
    await page.keyboard.press("Escape");
  });

  test("the French page has every label", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/inventory/units?status=active", { waitUntil: "networkidle" });
    const box = page.getByRole("checkbox", { name: /^Sélectionner (?!toutes)/ }).first();
    test.skip((await box.count()) === 0, "no active unit in the development database");
    await box.check();
    const bar = page.getByRole("region", { name: "Actions pour les unités sélectionnées" });
    await expect(bar.getByText("1 unité sélectionnée")).toBeVisible();
    for (const label of [
      "Déplacer",
      "Changer l’étape",
      "Mettre en retenue",
      "Consigner la destruction",
    ]) {
      await expect(bar.getByRole("button", { name: label })).toBeVisible();
    }
    await expectNoBlockingViolations(page);
  });
});
