import { routing } from "@/i18n/routing";

/**
 * Pure routing rules used by the proxy: which URLs are files, which pages are public, and how to
 * split the language prefix off a path. Kept separate so they can be unit tested.
 */

/** Pages that anyone may open, written without the language prefix. */
const PUBLIC_PAGES = ["/", "/login"];
const PUBLIC_PAGE_PREFIXES = ["/scan/", "/invite/"];
const PUBLIC_API = ["/api/health", "/api/ready"];
const PUBLIC_API_PREFIXES = ["/api/auth/"];

/** Static files and generated metadata routes (`/icon`, `/opengraph-image` have no extension). */
export function isAssetPath(pathname: string): boolean {
  if (/\.(png|jpe?g|webp|svg|ico|css|js|map|txt|xml|webmanifest|woff2?)$/.test(pathname)) {
    return true;
  }
  return ["/_next/", "/icon", "/apple-icon", "/opengraph-image"].some((prefix) =>
    pathname.startsWith(prefix)
  );
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isPublicApi(pathname: string): boolean {
  return (
    PUBLIC_API.includes(pathname) ||
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/** `/fr/units/3` -> `{ locale: "fr", path: "/units/3" }`; no known prefix -> `locale: null`. */
export function splitLocale(pathname: string): { locale: string | null; path: string } {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return { locale, path: "/" };
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, path: pathname.slice(locale.length + 1) };
    }
  }
  return { locale: null, path: pathname };
}

/** `path` is the page path without the language prefix. */
export function isPublicPage(path: string): boolean {
  if (PUBLIC_PAGES.includes(path)) return true;
  return PUBLIC_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix));
}
