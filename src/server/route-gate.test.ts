import { describe, expect, it } from "vitest";
import { isApiPath, isAssetPath, isPublicApi, isPublicPage, splitLocale } from "./route-gate";

describe("splitLocale", () => {
  it.each([
    ["/en", "en", "/"],
    ["/fr/units/3", "fr", "/units/3"],
    ["/en/login", "en", "/login"],
  ])("splits %s", (input, locale, path) => {
    expect(splitLocale(input)).toEqual({ locale, path });
  });

  it("does not mistake a path that merely starts with the letters", () => {
    expect(splitLocale("/english")).toEqual({ locale: null, path: "/english" });
    expect(splitLocale("/frame/1")).toEqual({ locale: null, path: "/frame/1" });
    expect(splitLocale("/units")).toEqual({ locale: null, path: "/units" });
  });
});

describe("public pages", () => {
  it.each(["/", "/login", "/invite/abc", "/scan/12"])("%s is public", (path) => {
    expect(isPublicPage(path)).toBe(true);
  });

  it.each(["/dashboard", "/units", "/members/3", "/loginx", "/invite", "/scanner"])(
    "%s is private",
    (path) => {
      expect(isPublicPage(path)).toBe(false);
    }
  );
});

describe("assets and api", () => {
  it("recognises files and metadata routes, not pages", () => {
    for (const p of [
      "/favicon.ico",
      "/icon.svg",
      "/apple-icon",
      "/opengraph-image",
      "/robots.txt",
      "/_next/data/x.json".replace(".json", ".js"),
    ]) {
      expect(isAssetPath(p), p).toBe(true);
    }
    for (const p of ["/en/units", "/dashboard", "/api/health"])
      expect(isAssetPath(p), p).toBe(false);
  });

  it("knows which api routes are open", () => {
    expect(isApiPath("/api/units")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
    for (const p of ["/api/health", "/api/ready", "/api/auth/login", "/api/auth/mfa/verify"]) {
      expect(isPublicApi(p), p).toBe(true);
    }
    for (const p of ["/api/units", "/api/members/1", "/api/healthz"])
      expect(isPublicApi(p), p).toBe(false);
  });
});
