import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { env } from "@/server/env";
import {
  isApiPath,
  isAssetPath,
  isPublicApi,
  isPublicPage,
  splitLocale,
} from "@/server/route-gate";
import { applySecurityHeaders, generateNonce, securityHeaders } from "@/server/security-headers";
import { sessionCookieName } from "@/server/session-cookie";

/**
 * The single entry point for every request: language prefix, authentication gate, security headers.
 *
 * Every lab surface is private: inventory, lineage and custody data must not be readable
 * anonymously. The gate only checks that a session cookie is present (it runs before any database
 * access), so pages and API routes still validate the session via `getSessionUser` /
 * `requirePageUser` / `withApi`.
 */
const handleLocale = createIntlMiddleware(routing);

function unauthenticatedApi() {
  return NextResponse.json(
    { ok: false, error: "Sign in required", code: "UNAUTHENTICATED" },
    { status: 401 }
  );
}

function route(request: NextRequest, requestHeaders: Headers): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(sessionCookieName())?.value);
  const forward = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (isApiPath(pathname)) {
    return isPublicApi(pathname) || hasSession ? forward() : unauthenticatedApi();
  }
  if (isAssetPath(pathname)) return forward();

  // Pages: add or negotiate the language prefix first (this may redirect `/` to `/en`).
  const localized = handleLocale(new NextRequest(request, { headers: requestHeaders }));
  if (localized.headers.has("location")) return localized;

  const { locale, path } = splitLocale(pathname);
  if (isPublicPage(path) || hasSession) return localized;

  const loginUrl = new URL(`/${locale ?? routing.defaultLocale}/login`, request.url);
  loginUrl.searchParams.set("next", `${path}${search}`);
  return NextResponse.redirect(loginUrl);
}

/**
 * Runs the routing, then stamps the security headers on whatever it produced (page, API response,
 * redirect or 401). The CSP and `x-nonce` are also forwarded on the request so Next.js can nonce
 * its own scripts.
 */
export function proxy(request: NextRequest) {
  const { APP_URL, NODE_ENV } = env();
  const nonce = generateNonce();
  const headers = securityHeaders({
    nonce,
    dev: NODE_ENV === "development",
    https: APP_URL.startsWith("https://"),
    pathname: request.nextUrl.pathname,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  const response = route(request, requestHeaders);
  applySecurityHeaders(response, headers);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
