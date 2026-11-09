import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoBlockingViolations } from "./a11y";
import { e2eCredentials, signIn } from "./helpers";

// A route compiles the first time it is requested (next dev), which can take several seconds.
const expect = baseExpect.configure({ timeout: 20_000 });

const STAMP = Date.now();
const NAME = (kind: string) => `E2E-${kind}-${STAMP}`;

/** The first link on a list page that points at a record of this section, if any record exists. */
async function firstRecordPath(page: Page, locale: string, section: string) {
  await page.goto(`/${locale}/${section}`, { waitUntil: "networkidle" });
  const links = page.locator(`main a[href^="/${locale}/${section}/"]`);
  for (const href of await links.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")))) {
    if (href && /\/\d+$/.test(href)) return href;
  }
  return null;
}

test.describe("records: accessibility", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  for (const locale of ["en", "fr"] as const) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`${locale} ${colorScheme}: every list and detail page has no serious or critical violations`, async ({
        page,
      }) => {
        test.setTimeout(240_000);
        await page.emulateMedia({ colorScheme });
        await signIn(page, locale);

        const check = async (path: string) => {
          await page.goto(path, { waitUntil: "networkidle" });
          await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
          await expectNoBlockingViolations(page);
        };

        for (const list of [
          "locations",
          "cultivars",
          "cultivars?view=table",
          "organizations",
          "organizations/new",
          "members",
        ]) {
          await check(`/${locale}/${list}`);
        }
        for (const section of ["cultivars", "organizations", "members"]) {
          const detail = await firstRecordPath(page, locale, section);
          if (detail) await check(detail);
        }
      });
    }
  }
});

test.describe("records: locations", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("create, edit, search, retire with a reason, and reactivate, all from the keyboard-reachable controls", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const name = NAME("room");
    await signIn(page, "en");
    await page.goto("/en/records/locations", { waitUntil: "networkidle" });

    // Create.
    await page.getByRole("button", { name: "New location" }).click();
    const dialog = page.getByRole("dialog", { name: "New location" });
    await dialog.getByLabel(/^Name/).fill("x");
    await dialog.getByRole("button", { name: "Create location" }).click();
    await expect(dialog.getByText("Enter a name of at least 2 characters.")).toBeVisible();
    await dialog.getByLabel(/^Name/).fill(name);
    // There is no code to type: the server gives the room the next R- number.
    await expect(dialog.getByLabel(/^Room code/)).toHaveCount(0);
    await dialog.getByLabel("Capacity (units)").fill("5");
    await dialog.getByRole("button", { name: "Create location" }).click();
    await expect(dialog).toBeHidden();

    // It is found by search, with its capacity written out.
    // Cards are the default view: one card per room, which opens the room.
    await page.goto(`/en/records/locations?q=${encodeURIComponent(name)}`, {
      waitUntil: "networkidle",
    });
    const card = page.getByRole("article").filter({ hasText: name });
    await expect(card.getByText(/0 of 5 units/)).toBeVisible();
    await expect(card.getByText(/^R-\d{3,}$/)).toBeVisible();
    await page.getByRole("link", { name: "Table" }).click();
    await expect(page).toHaveURL(/view=table/);
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("meter")).toHaveAttribute("aria-valuemax", "5");
    await expect(row.getByText(/0 of 5 units/)).toBeVisible();
    await expect(row.getByText(/^R-\d{3,}$/)).toBeVisible();

    // Edit through the row menu.
    await row.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await edit.getByLabel(/^Description/).fill("Room for the E2E test");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByText("Room for the E2E test").first()).toBeVisible();

    // The room has its own page: the list's link opens it, not the units list.
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/en\/records\/locations\/\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByRole("heading", { name: "Units stored here" })).toBeVisible();
    await page.goBack({ waitUntil: "networkidle" });

    // Retire: Escape cancels and returns focus to the menu button, then it is done with a reason.
    const menuButton = page.getByRole("button", { name: `Actions for ${name}` });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Retire" }).press("Enter");
    const confirm = page.getByRole("dialog", { name: `Retire ${name}?` });
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();

    await menuButton.click();
    await page.getByRole("menuitem", { name: "Retire" }).click();
    const again = page.getByRole("dialog", { name: `Retire ${name}?` });
    const submit = again.getByRole("button", { name: "Retire location" });
    await expect(submit).toBeDisabled();
    await again.getByLabel("Reason").fill("E2E: room closed for the test");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(again).toBeHidden();

    await page.goto(
      `/en/records/locations?q=${encodeURIComponent(name)}&status=retired&view=table`,
      {
        waitUntil: "networkidle",
      }
    );
    await expect(
      page.getByRole("row", { name: new RegExp(name) }).getByText("Retired")
    ).toBeVisible();

    // Bring it back.
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Reactivate" }).click();
    await page
      .getByRole("dialog", { name: `Reactivate ${name}?` })
      .getByRole("button", { name: "Reactivate location" })
      .click();
    await expect(page.getByText("No locations match these filters")).toBeVisible();
  });

  test("search treats % as a character and the status filter lives in the URL", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/records/locations?q=%25", { waitUntil: "networkidle" });
    await expect(page.getByText("Aucun emplacement ne correspond à ces filtres")).toBeVisible();
    await page.getByRole("link", { name: "Effacer les filtres" }).click();
    await page.getByRole("button", { name: /^Statut/ }).click();
    await page.getByRole("menuitem", { name: "Retiré", exact: true }).click();
    await expect(page).toHaveURL(/\/fr\/records\/locations\?.*status=retired/);
  });
});

test.describe("records: cultivars", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("add a cultivar, find it in both views, edit it", async ({ page }) => {
    test.setTimeout(120_000);
    const name = NAME("cultivar");
    await signIn(page, "en");
    await page.goto("/en/records/cultivars", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Add cultivar" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a cultivar" });
    await dialog.getByLabel(/^Name/).fill(name);
    await dialog.getByLabel(/^Expected total THC/).fill("140");
    await dialog.getByRole("button", { name: "Add cultivar" }).click();
    await expect(
      dialog.getByText("Enter a number from 0 to 100, or leave it empty.")
    ).toBeVisible();
    await dialog.getByLabel(/^Expected total THC/).fill("21.5");
    await dialog.getByRole("button", { name: "Add cultivar" }).click();
    await expect(dialog).toBeHidden();

    const search = `/en/records/cultivars?q=${encodeURIComponent(name)}`;
    await page.goto(search, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 3, name })).toBeVisible();
    await page.goto(`${search}&view=table`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("21.5%")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await edit.getByLabel("Category").fill("E2E category");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByText("E2E category").first()).toBeVisible();
    await expect(page.getByText("No units yet")).toBeVisible();
  });
});

test.describe("records: organization documents", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("add a document from the organization page and download it", async ({ page }) => {
    test.setTimeout(120_000);
    const name = NAME("org-doc");
    await signIn(page, "en");
    const created = await page.request.post("/api/organizations", {
      data: { name, address: "1 Test Street, Quebec City" },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { organization } = (await created.json()) as { organization: { id: number } };

    await page.goto(`/en/records/organizations/${organization.id}`, { waitUntil: "networkidle" });
    await expect(page.getByText("No documents yet.")).toBeVisible();
    await page.getByRole("button", { name: "Add document" }).first().click();
    const dialog = page.getByRole("dialog", { name: `Add a document to ${name}` });

    // A file is required.
    await dialog.getByRole("button", { name: "Add document" }).click();
    await expect(dialog.getByText("Choose a file first.")).toBeVisible();
    await expectNoBlockingViolations(page);

    await dialog.getByLabel(/^File/).setInputFiles({
      name: "licence.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Licence LIC-E2E\n"),
    });
    await dialog.getByLabel(/^Name/).fill("Licence 2026");
    await dialog.getByRole("button", { name: "Add document" }).click();
    await expect(dialog).toBeHidden();

    const link = page.getByRole("link", { name: /^Licence 2026/ });
    await expect(link).toBeVisible();
    const response = await page.request.get((await link.getAttribute("href"))!);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe("Licence LIC-E2E\n");
    await expectNoBlockingViolations(page);
  });
});

test.describe("records: register an organization with documents", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("files chosen on the form are attached once the organization is registered", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const name = NAME("org-files");
    await signIn(page, "en");
    await page.goto("/en/records/organizations/new", { waitUntil: "networkidle" });

    await page.getByLabel("Organization name").fill(name);
    await page.getByLabel(/^Address/).fill("1 Test Street, Quebec City");
    const documents = page.getByLabel(/^Documents/);
    await documents.setInputFiles([
      { name: "licence.txt", mimeType: "text/plain", buffer: Buffer.from("Licence one\n") },
      { name: "agreement.txt", mimeType: "text/plain", buffer: Buffer.from("Agreement\n") },
    ]);
    const chosen = page.getByRole("list", { name: "Documents to attach" });
    await expect(chosen.getByRole("listitem")).toHaveCount(2);
    // A file can be taken out again before registering.
    await page.getByRole("button", { name: "Remove agreement.txt" }).click();
    await expect(chosen.getByRole("listitem")).toHaveCount(1);
    await expectNoBlockingViolations(page);

    await page.getByRole("button", { name: "Register organization" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /^licence.txt/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^agreement.txt/ })).toHaveCount(0);
  });
});

test.describe("records: cultivar cards", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("a card shows status bars and details, and a location opens its summary", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, "en");
    await page.goto("/en/records/cultivars?usage=used", { waitUntil: "networkidle" });
    const card = page.getByRole("article").first();
    test.skip((await card.count()) === 0, "no cultivar with units in the development database");

    for (const bar of ["Unit status", "Unit types"]) {
      await expect(card.getByText(bar, { exact: true }).first()).toBeVisible();
    }
    await expect(card.getByText("Created", { exact: true })).toBeVisible();
    await expect(card.getByText("Last activity", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "Details" })).toHaveCount(0);

    // "+N more" opens the rest of the places in place, and "Show fewer" folds them again.
    const more = card.getByRole("button", { name: /^\+\d+ more$/ });
    if ((await more.count()) > 0) {
      const places = card.getByRole("button", { name: /Open the summary of this location/ });
      const before = await places.count();
      await more.click();
      await expect(places).not.toHaveCount(before);
      await card.getByRole("button", { name: "Show fewer" }).click();
      await expect(places).toHaveCount(before);
    }

    const place = card.getByRole("button", { name: /Open the summary of this location/ }).first();
    test.skip((await place.count()) === 0, "no unit is stored anywhere");
    await place.click();
    const summary = page.getByRole("dialog");
    await expect(summary.getByText("Units in inventory")).toBeVisible({ timeout: 30_000 });
    await expect(summary.getByText("Capacity", { exact: true })).toBeVisible();
    await expect(summary.getByRole("link", { name: "View the units here" })).toBeVisible();
    await expectNoBlockingViolations(page);
    await page.keyboard.press("Escape");
    await expect(summary).toBeHidden();
  });
});

test.describe("records: organizations", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("register, refuse a duplicate, open and edit", async ({ page }) => {
    test.setTimeout(120_000);
    const name = NAME("org");
    await signIn(page, "en");
    await page.goto("/en/records/organizations/new", { waitUntil: "networkidle" });

    await page.getByLabel("Organization name").fill("x");
    await page.getByRole("button", { name: "Register organization" }).click();
    await expect(page.getByText("Enter a name of at least 2 characters.")).toBeVisible();
    // The address is required too.
    await expect(page.getByText("Enter the organization's address.")).toBeVisible();

    await page.getByLabel("Organization name").fill(name);
    await page.getByLabel(/^Address/).fill("1 Test Street, Quebec City");
    await page.getByLabel("Country").fill("CA");
    await page.getByLabel("Licence number").fill("LIC-E2E");
    await page.getByLabel("Health Canada licence class").selectOption("RESEARCH");
    await page.getByRole("button", { name: "Register organization" }).click();
    await expect(page).toHaveURL(/\/en\/records\/organizations\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Research", { exact: true })).toBeVisible();
    await expect(page.getByText("Nothing received yet")).toBeVisible();

    // The same name again is refused and points at the existing record.
    await page.goto("/en/records/organizations/new", { waitUntil: "networkidle" });
    await page.getByLabel("Organization name").fill(name.toLowerCase());
    await page.getByLabel(/^Address/).fill("2 Test Street, Quebec City");
    await page.getByRole("button", { name: "Register organization" }).click();
    await expect(page.getByRole("link", { name: "Open the existing record" })).toBeVisible();

    await page.goto(`/en/records/organizations?q=${encodeURIComponent(name)}`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await edit.getByLabel("Notes").fill("E2E contact: nobody");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByText("E2E contact: nobody")).toBeVisible();
    await expect(page.getByText(/Updated organization profile/)).toBeVisible();
  });
});

test.describe("records: members", () => {
  test.skip(!e2eCredentials(), "needs E2E_USER / E2E_PASSWORD or a local dev admin");

  test("invite shows a one-time link, a new link replaces it, and the invitation can be revoked", async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    const name = `E2E-${STAMP}`;
    await signIn(page, "en");
    await page.goto("/en/records/members", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Invite member" }).click();
    const invite = page.getByRole("dialog", { name: "Invite a member" });
    await invite.getByLabel("Username").fill(name);
    await invite.getByLabel("E-mail address").fill("not-an-address");
    await invite.getByRole("button", { name: "Create invitation" }).click();
    await expect(invite.getByText("Enter a valid e-mail address.")).toBeVisible();
    await invite.getByLabel("E-mail address").fill(`e2e-${STAMP}@example.com`);
    await invite.getByRole("button", { name: "Create invitation" }).click();

    const ready = page.getByRole("dialog", { name: "Invitation ready" });
    const link = ready.getByLabel("Invitation link");
    await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const first = await link.inputValue();
    await expect(ready.getByRole("link", { name: /E-mail it to e2e-/ })).toHaveAttribute(
      "href",
      /^mailto:/
    );
    await ready.getByRole("button", { name: "Copy link" }).click();
    await expect(ready.getByRole("button", { name: "Copied" })).toBeVisible();
    await ready.getByRole("button", { name: "Done" }).click();
    await expect(ready).toBeHidden();

    // The invited member is listed, with a status that is not only a colour.
    await page.goto(`/en/records/members?q=${encodeURIComponent(name)}`, {
      waitUntil: "networkidle",
    });
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row.getByText("Invited")).toBeVisible();

    // Keyboard: open the menu, issue a new link, confirm; the old link is replaced.
    const menuButton = row.getByRole("button", { name: `Actions for ${name}` });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Issue a new link" }).press("Enter");
    const confirm = page.getByRole("dialog", { name: `Issue a new link for ${name}?` });
    await confirm.getByRole("button", { name: "Issue new link" }).press("Enter");
    const second = page.getByRole("dialog", { name: "New invitation link" });
    await expect(second.getByLabel("Invitation link")).not.toHaveValue(first);
    await second.getByRole("button", { name: "Done" }).click();

    // Revoke: Escape backs out, the confirmed action removes the pending account.
    await menuButton.click();
    await page.getByRole("menuitem", { name: "Revoke invitation" }).click();
    await expect(
      page.getByRole("dialog", { name: `Revoke the invitation for ${name}?` })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await menuButton.click();
    await page.getByRole("menuitem", { name: "Revoke invitation" }).click();
    await page
      .getByRole("dialog", { name: `Revoke the invitation for ${name}?` })
      .getByRole("button", { name: "Revoke invitation" })
      .click();
    await expect(page.getByText("No members match these filters")).toBeVisible();
  });

  test("the member page has no security section, lets an admin assign a task, and offers the data export", async ({
    page,
  }) => {
    await signIn(page, "en");
    await page.goto("/en/records/members", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "admin", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Security" })).toHaveCount(0);
    await expect(page.getByText("Active sessions")).toHaveCount(0);
    // A task given from a member's page is for that member.
    await page.getByRole("button", { name: "Assign a task" }).click();
    const dialog = page.getByRole("dialog", { name: "Plan a task" });
    await expect(dialog.getByLabel(/^Assigned to|^Who does it/)).not.toHaveValue("");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Export personal data" })).toBeVisible();
  });

  test("the export is a JSON download that is refused to people who are not signed in", async ({
    page,
    playwright,
  }) => {
    await signIn(page, "en");
    const response = await page.request.get("/api/members/1/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toMatch(
      /attachment; filename="member-0001-export-/
    );
    const body = await response.json();
    expect(body.format).toBe("accession-book/member-export@1");
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|tokenHash|mfaSecret/);

    const anonymous = await playwright.request.newContext({ baseURL: page.url().split("/en")[0] });
    expect((await anonymous.get("/api/members/1/export")).status()).toBe(401);
    await anonymous.dispose();
  });
});
