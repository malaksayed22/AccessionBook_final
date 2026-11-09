import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/**
 * Signed-in tests need a real account. Provide E2E_USER and E2E_PASSWORD (CI seeds one); locally
 * they use the administrator of the e2e database (scripts/e2e-server.ts), or the dev admin when the
 * tests are pointed at the dev server. Returns null when none exists, and the calling test skips.
 */
export function e2eCredentials(): { name: string; password: string } | null {
  if (process.env.E2E_USER && process.env.E2E_PASSWORD) {
    return { name: process.env.E2E_USER, password: process.env.E2E_PASSWORD };
  }
  for (const file of [".local/e2e-admin-password.txt", ".local/dev-admin-password.txt"]) {
    try {
      const password = readFileSync(file, "utf8").trim();
      if (password) return { name: "admin", password };
    } catch {
      // Try the next file.
    }
  }
  return null;
}

const SESSION_FILE = ".local/e2e-session.json";
/** Sessions idle out after 30 minutes; reuse a cached one for at most this long. */
const REUSE_MS = 15 * 60_000;

type CachedSession = { name: string; value: string; savedAt: number };

function readCached(): CachedSession | null {
  try {
    const cached = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as CachedSession;
    return Date.now() - cached.savedAt < REUSE_MS ? cached : null;
  } catch {
    return null;
  }
}

/**
 * Signs in and lands on the dashboard. The session cookie is cached on disk and reused, so a full
 * test run (or several runs at once) makes one sign-in instead of dozens; the sign-in endpoint is
 * rate limited per address, and it should stay that way. Pass `fresh` to force a new sign-in.
 */
export async function signIn(
  page: Page,
  locale: "en" | "fr" = "en",
  options: { fresh?: boolean } = {}
) {
  const base = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
  const cached = options.fresh ? null : readCached();

  if (cached) {
    await page
      .context()
      .addCookies([
        { name: cached.name, value: cached.value, url: base, httpOnly: true, sameSite: "Lax" },
      ]);
    // A revoked or expired cached session falls through to a real sign-in below.
    const probe = await page.request.get("/api/auth/sessions");
    if (!probe.ok()) return signIn(page, locale, { fresh: true });
  } else {
    const credentials = e2eCredentials();
    if (!credentials) throw new Error("no e2e credentials");
    const response = await page.request.post("/api/auth/login", { data: credentials });
    if (!response.ok()) throw new Error(`sign-in failed: ${response.status()}`);
    const session = (await page.context().cookies()).find((c) =>
      /accessionbook_session$/.test(c.name)
    );
    if (session) {
      writeFileSync(
        SESSION_FILE,
        JSON.stringify({ name: session.name, value: session.value, savedAt: Date.now() })
      );
    }
  }
  // Interactive controls only work once React has hydrated; wait for the page to settle.
  await page.goto(`/${locale}/dashboard`, { waitUntil: "networkidle" });
}
