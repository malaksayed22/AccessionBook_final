import { env } from "./env";

/**
 * The caller's address, for rate limits and the audit trail. `X-Forwarded-For` is a list that every
 * proxy appends to, so entries on the left are whatever the client claimed. Only the entry added by
 * our own trusted proxy (counted from the right) is believed.
 */
export function clientIp(headers: Headers): string | null {
  const hops = env().TRUSTED_PROXY_HOPS;
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (hops > 0 && forwarded?.length) {
    return forwarded[Math.max(0, forwarded.length - hops)] ?? null;
  }
  return null;
}
