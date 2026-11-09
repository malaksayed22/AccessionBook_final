import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/units/12?tab=history", "/units/12?tab=history"],
    ["/reports#top", "/reports#top"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/%0d%0aSet-Cookie:x=1".replace("%0d%0a", "\r\n"),
    "dashboard",
    "",
    "/ok\u0000",
  ])("falls back for %j", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });

  it("falls back when missing", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined, "/home")).toBe("/home");
  });
});
