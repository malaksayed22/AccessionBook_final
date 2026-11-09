/**
 * HTTP security headers and the nonce-based Content-Security-Policy.
 *
 * Pure functions with no `process.env` access: the caller (src/proxy.ts) passes in
 * whether it runs in development and whether the public origin is https. Safe to
 * import from the proxy.
 */

export type SecurityHeaderOptions = {
  /** Per-request random value, also exposed to the app as the `x-nonce` request header. */
  nonce: string;
  /** Development server: React/Turbopack need eval, HMR needs a websocket. */
  dev: boolean;
  /** The public origin is https: enables HSTS and upgrade-insecure-requests. */
  https: boolean;
  /** Request path; invitation links must not leak their token through Referer. */
  pathname?: string;
};

const HSTS = "max-age=63072000; includeSubDomains; preload";
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

/** 128 bits of randomness, base64 encoded (valid in a CSP `'nonce-…'` source). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy(
  nonce: string,
  { dev, https = false }: { dev: boolean; https?: boolean }
): string {
  const nonceSource = `'nonce-${nonce}'`;
  const directives: string[] = [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced framework scripts load their chunks.
    `script-src 'self' ${nonceSource} 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // A nonce makes browsers ignore 'unsafe-inline', so dev (injected HMR styles, which
    // cannot carry a nonce) uses 'unsafe-inline' alone.
    `style-src-elem 'self' ${dev ? "'unsafe-inline'" : nonceSource}`,
    // Inline style="" attributes: the UI sets dynamic widths/colours that way. Attributes
    // cannot execute script, so this is the narrow, deliberate exception.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export type SecurityHeaders = Record<string, string> & { "Content-Security-Policy": string };

export function securityHeaders({
  nonce,
  dev,
  https,
  pathname = "/",
}: SecurityHeaderOptions): SecurityHeaders {
  const headers: SecurityHeaders = {
    "Content-Security-Policy": buildContentSecurityPolicy(nonce, { dev, https }),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": /^\/(?:[a-z]{2}\/)?invite\//.test(pathname)
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
  };
  if (https) headers["Strict-Transport-Security"] = HSTS;
  return headers;
}

/** Copies every header onto a response, replacing existing values. */
export function applySecurityHeaders(
  response: { headers: Headers },
  headers: Record<string, string>
): void {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
}
