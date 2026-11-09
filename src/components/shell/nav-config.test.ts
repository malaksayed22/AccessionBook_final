import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HUB_KEYS,
  NAV_HUBS,
  TAB_KEYS,
  hubForPath,
  isActivePath,
  tabForPath,
  visibleHubs,
} from "./nav-config";

const shell = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../messages/en/shell.json"), "utf8")
);

describe("navigation config", () => {
  it("lists every tab exactly once and has a label and hint for it", () => {
    const keys = NAV_HUBS.flatMap((h) => h.tabs.map((t) => t.key));
    expect([...keys].sort()).toEqual([...TAB_KEYS].sort());
    for (const key of keys) {
      expect(shell.nav.tabs[key]?.label, key).toBeTruthy();
      expect(shell.nav.tabs[key]?.hint, key).toBeTruthy();
    }
    for (const key of HUB_KEYS) {
      expect(shell.nav.hubs[key]?.label, key).toBeTruthy();
      expect(shell.nav.hubs[key]?.hint, key).toBeTruthy();
    }
  });

  it("hides the administrator tabs from members", () => {
    const tabsOf = (showCompliance: boolean) =>
      visibleHubs(showCompliance).flatMap((h) => h.tabs.map((t) => t.key));
    expect(tabsOf(false)).not.toContain("audit");
    expect(tabsOf(false)).not.toContain("reports");
    expect(tabsOf(true)).toContain("audit");
    expect(tabsOf(true)).toContain("reports");
    // Settings are administrators' alone, even for those who read the compliance records.
    expect(tabsOf(true)).not.toContain("settings");
    expect(visibleHubs(true, true).flatMap((h) => h.tabs.map((t) => t.key))).toContain("settings");
  });

  it("leaves out the tabs of a module the lab has switched off", () => {
    const quality = (hidden: Parameters<typeof visibleHubs>[2]) =>
      visibleHubs(true, true, hidden)
        .find((h) => h.key === "quality")!
        .tabs.map((t) => t.key);
    expect(quality([])).toContain("sops");
    expect(quality(["sops"])).toEqual(["holds", "recall"]);
  });

  it("matches whole path segments only", () => {
    expect(isActivePath("/inventory/units/12", "/inventory/units")).toBe(true);
    expect(isActivePath("/inventory/units", "/inventory/units")).toBe(true);
    expect(isActivePath("/inventory/unitsx", "/inventory/units")).toBe(false);
    expect(hubForPath("/inventory/experiments/4")?.key).toBe("inventory");
    expect(hubForPath("/nowhere")).toBeUndefined();
  });

  it("gives a nested tab the longest matching path", () => {
    expect(tabForPath("/compliance/reports/ctls")?.key).toBe("reports");
    expect(tabForPath("/quality/recall")?.key).toBe("recall");
    expect(tabForPath("/quality")?.key).toBe("holds");
  });

  it("keeps every tab inside its hub's URL prefix", () => {
    for (const navHub of NAV_HUBS) {
      for (const tab of navHub.tabs)
        expect(isActivePath(tab.href, navHub.base), tab.key).toBe(true);
    }
  });
});
