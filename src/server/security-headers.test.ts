import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  generateNonce,
  securityHeaders,
} from "./security-headers";

const NONCE = "dGVzdC1ub25jZQ==";

function directive(csp: string, name: string): string {
  return csp.split("; ").find((part) => part === name || part.startsWith(`${name} `)) ?? "";
}

describe("generateNonce", () => {
  it("is unique, base64 and 128 bits", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(a).length).toBe(16);
  });
});

describe("buildContentSecurityPolicy", () => {
  const prod = buildContentSecurityPolicy(NONCE, { dev: false, https: true });
  const dev = buildContentSecurityPolicy(NONCE, { dev: true, https: false });

  it("produces the exact production policy", () => {
    expect(prod).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
        `style-src-elem 'self' 'nonce-${NONCE}'`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; ")
    );
  });

  it("embeds the nonce in script and style elements", () => {
    expect(directive(prod, "script-src")).toContain(`'nonce-${NONCE}'`);
    expect(directive(prod, "style-src-elem")).toContain(`'nonce-${NONCE}'`);
  });

  it("allows eval and websockets only in development", () => {
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/\bws:/);
  });

  it("allows inline style elements only in development", () => {
    expect(directive(dev, "style-src-elem")).toContain("'unsafe-inline'");
    expect(directive(prod, "style-src-elem")).not.toContain("'unsafe-inline'");
  });

  it("never allows unsafe-inline for scripts", () => {
    for (const csp of [prod, dev])
      expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
  });

  it("only upgrades insecure requests over https", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(buildContentSecurityPolicy(NONCE, { dev: false })).not.toContain(
      "upgrade-insecure-requests"
    );
  });

  it("uses no wildcard sources and locks down framing, plugins and base", () => {
    for (const csp of [prod, dev]) {
      expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
      expect(csp).not.toMatch(/https?:\/\/\*/);
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
    }
  });
});

describe("securityHeaders", () => {
  it("sends the full set over https", () => {
    const headers = securityHeaders({ nonce: NONCE, dev: false, https: true });
    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    );
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(headers["X-DNS-Prefetch-Control"]).toBe("off");
    expect(headers["Content-Security-Policy"]).toContain(`'nonce-${NONCE}'`);
  });

  it("omits HSTS over plain http", () => {
    const headers = securityHeaders({ nonce: NONCE, dev: true, https: false });
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("suppresses the referrer on invitation links", () => {
    const options = { nonce: NONCE, dev: false, https: true };
    expect(securityHeaders({ ...options, pathname: "/invite/abc" })["Referrer-Policy"]).toBe(
      "no-referrer"
    );
    for (const pathname of ["/en/invite/abc", "/fr/invite/abc"]) {
      expect(securityHeaders({ ...options, pathname })["Referrer-Policy"]).toBe("no-referrer");
    }
    expect(securityHeaders({ ...options, pathname: "/en/login" })["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(securityHeaders({ ...options, pathname: "/login" })["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin"
    );
  });
});

describe("applySecurityHeaders", () => {
  it("overwrites existing values on a response", () => {
    const response = new Response(null, { headers: { "X-Frame-Options": "SAMEORIGIN" } });
    applySecurityHeaders(response, securityHeaders({ nonce: NONCE, dev: false, https: false }));
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });
});
