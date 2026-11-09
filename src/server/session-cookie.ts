import "server-only";
import { BRAND } from "@/lib/brand";
import { env } from "./env";

/**
 * Over https the cookie carries the `__Host-` prefix: browsers then refuse it unless it is Secure,
 * host-only and path `/`, so a sibling subdomain cannot plant or overwrite it. Plain-http local
 * development cannot use the prefix.
 */
export function sessionCookieName(): string {
  return env().COOKIE_SECURE ? `__Host-${BRAND.sessionCookie}` : BRAND.sessionCookie;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().COOKIE_SECURE,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
