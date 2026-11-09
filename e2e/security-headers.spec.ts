import { expect, test, type ConsoleMessage } from "@playwright/test";

const REQUIRED_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-dns-prefetch-control": "off",
};

function nonceOf(csp: string | undefined): string {
  expect(csp, "Content-Security-Policy header").toBeDefined();
  const match = /script-src [^;]*'nonce-([^']+)'/.exec(csp ?? "");
  expect(match, `no script nonce in: ${csp}`).not.toBeNull();
  return match?.[1] ?? "";
}

test.describe("security headers", () => {
  for (const path of ["/en/login", "/api/health"]) {
    test(`${path} carries the full header set and a strict CSP`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const headers = response.headers();

      for (const [name, value] of Object.entries(REQUIRED_HEADERS))
        expect(headers[name], name).toBe(value);

      const csp = headers["content-security-policy"] ?? "";
      const nonce = nonceOf(csp);
      expect(csp).toContain(`style-src-elem 'self'`);
      expect(csp).toContain("style-src-attr 'unsafe-inline'");
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(nonce.length).toBeGreaterThanOrEqual(22);

      const scriptSrc = csp.split("; ").find((part) => part.startsWith("script-src "))!;
      expect(scriptSrc).not.toContain("unsafe-inline");
    });
  }

  test("the nonce differs on every request", async ({ request }) => {
    const first = nonceOf((await request.get("/en/login")).headers()["content-security-policy"]);
    const second = nonceOf((await request.get("/en/login")).headers()["content-security-policy"]);
    expect(first).not.toBe(second);
  });

  test("redirects and 401 responses are covered too", async ({ request }) => {
    const redirect = await request.get("/en/records/members", { maxRedirects: 0 });
    expect(redirect.status()).toBeGreaterThanOrEqual(300);
    expect(redirect.status()).toBeLessThan(400);
    expect(redirect.headers()["content-security-policy"] ?? "").toContain("default-src 'self'");
    expect(redirect.headers()["x-frame-options"]).toBe("DENY");

    const refused = await request.get("/api/units/1/ledger");
    expect(refused.status()).toBe(401);
    expect(refused.headers()["content-security-policy"] ?? "").toContain("default-src 'self'");
    expect(refused.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("invitation pages send no referrer", async ({ request }) => {
    const response = await request.get("/en/invite/not-a-real-token");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  });

  test("the script nonce is applied to inline and framework scripts", async ({ request }) => {
    const response = await request.get("/en/login");
    const nonce = nonceOf(response.headers()["content-security-policy"]);
    const html = await response.text();
    expect(html).toContain(`nonce="${nonce}"`);
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)];
    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const [, attributes] of inlineScripts) expect(attributes).toContain(`nonce="${nonce}"`);
  });

  for (const path of ["/en", "/en/login", "/fr/login", "/en/invite/not-a-real-token"]) {
    test(`${path} loads without CSP violations and renders in its language`, async ({ page }) => {
      const messages: ConsoleMessage[] = [];
      page.on("console", (message) => messages.push(message));
      const pageErrors: Error[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        path.startsWith("/fr") ? "fr" : "en"
      );

      const violations = messages
        .map((message) => message.text())
        .filter((text) => /content security policy|violates the following|Refused to /i.test(text));
      expect(violations).toEqual([]);
      expect(pageErrors.map((error) => error.message)).toEqual([]);
    });
  }

  test("an explicit theme cookie is applied on the first byte, with no script", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([{ name: "ab_theme", value: "dark", url: baseURL! }]);
    const page = await context.newPage();
    const response = await page.goto("/en/login");
    expect(await response!.text()).toMatch(/<html[^>]*data-theme="dark"/);
    await context.close();
  });
});
