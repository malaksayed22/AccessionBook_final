import { describe, expect, it } from "vitest";
import { canConfirm, phraseMatches, reasonIsValid } from "./confirm-logic";
import { clampPage, pageCountFor, pageRange, pageWindow, parsePage } from "./pagination-logic";
import { ariaSortFor, nextSortOrder, parseSortOrder } from "./sort";
import { BADGE_TONES, STATUS_TONE, STATUSES } from "./status-tones";
import { dismissToast, getToasts, toast } from "./toast-store";

describe("pagination", () => {
  it("counts pages, never fewer than one", () => {
    expect(pageCountFor(130, 25)).toBe(6);
    expect(pageCountFor(125, 25)).toBe(5);
    expect(pageCountFor(0, 25)).toBe(1);
    expect(pageCountFor(5, 0)).toBe(1);
  });

  it("clamps and parses page numbers", () => {
    expect(clampPage(0, 6)).toBe(1);
    expect(clampPage(99, 6)).toBe(6);
    expect(clampPage(Number.NaN, 6)).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["4", "5"])).toBe(4);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });

  it("computes the visible row range", () => {
    expect(pageRange(1, 25, 130)).toEqual({ from: 1, to: 25 });
    expect(pageRange(6, 25, 130)).toEqual({ from: 126, to: 130 });
    expect(pageRange(99, 25, 130)).toEqual({ from: 126, to: 130 });
    expect(pageRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
  });

  it("builds a window with ellipses only where they hide two or more pages", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 5)).toEqual([1, 2, "ellipsis-end", 5]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 13)).toEqual([1, 2, "ellipsis-end", 13]);
    expect(pageWindow(7, 13)).toEqual([1, "ellipsis-start", 6, 7, 8, "ellipsis-end", 13]);
    expect(pageWindow(13, 13)).toEqual([1, "ellipsis-start", 12, 13]);
    // a gap of exactly one page is filled instead of elided
    expect(pageWindow(4, 8)).toEqual([1, 2, 3, 4, 5, "ellipsis-end", 8]);
    expect(pageWindow(5, 8)).toEqual([1, "ellipsis-start", 4, 5, 6, 7, 8]);
  });

  it("always includes the current page exactly once, in order", () => {
    for (let count = 1; count <= 20; count++) {
      for (let page = 1; page <= count; page++) {
        const numbers = pageWindow(page, count).filter((item) => typeof item === "number");
        expect(numbers).toContain(page);
        expect(new Set(numbers).size).toBe(numbers.length);
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      }
    }
  });
});

describe("sort", () => {
  it("starts a new column ascending and flips the active one", () => {
    expect(nextSortOrder({}, "name")).toBe("asc");
    expect(nextSortOrder({ sort: "name", order: "asc" }, "name")).toBe("desc");
    expect(nextSortOrder({ sort: "name", order: "desc" }, "name")).toBe("asc");
    expect(nextSortOrder({ sort: "name", order: "desc" }, "date")).toBe("asc");
  });

  it("exposes aria-sort only for the active column", () => {
    expect(ariaSortFor({ sort: "name", order: "asc" }, "name")).toBe("ascending");
    expect(ariaSortFor({ sort: "name", order: "desc" }, "name")).toBe("descending");
    expect(ariaSortFor({ sort: "name", order: "asc" }, "date")).toBeUndefined();
    expect(ariaSortFor({}, "name")).toBeUndefined();
  });

  it("parses the order from a query value", () => {
    expect(parseSortOrder("desc")).toBe("desc");
    expect(parseSortOrder("sideways")).toBe("asc");
    expect(parseSortOrder(undefined, "desc")).toBe("desc");
  });
});

describe("status tones", () => {
  it("maps every status to a known tone", () => {
    expect(Object.keys(STATUS_TONE).sort()).toEqual([...STATUSES].sort());
    for (const status of STATUSES) expect(BADGE_TONES).toContain(STATUS_TONE[status]);
  });

  it("keeps destroyed and hold states visually distinct from success", () => {
    expect(STATUS_TONE.destroyed).toBe("danger");
    expect(STATUS_TONE["on-hold"]).toBe("warning");
  });
});

describe("confirm rules", () => {
  const base = { reason: "", requireReason: false, typed: "", pending: false };

  it("needs nothing by default", () => {
    expect(canConfirm(base)).toBe(true);
  });

  it("blocks while pending", () => {
    expect(canConfirm({ ...base, pending: true })).toBe(false);
  });

  it("requires a reason of the minimum trimmed length", () => {
    expect(reasonIsValid("   short   ", true, 10)).toBe(false);
    expect(reasonIsValid("long enough reason", true, 10)).toBe(true);
    expect(reasonIsValid("", false, 10)).toBe(true);
    expect(canConfirm({ ...base, requireReason: true, reason: "x" })).toBe(false);
    expect(canConfirm({ ...base, requireReason: true, reason: "x".repeat(10) })).toBe(true);
    expect(canConfirm({ ...base, requireReason: true, reasonMinLength: 3, reason: "abc" })).toBe(
      true
    );
  });

  it("requires the exact phrase", () => {
    expect(phraseMatches("DESTROY", "DESTROY")).toBe(true);
    expect(phraseMatches(" DESTROY ", "DESTROY")).toBe(true);
    expect(phraseMatches("destroy", "DESTROY")).toBe(false);
    expect(phraseMatches("", undefined)).toBe(true);
    expect(canConfirm({ ...base, phrase: "DESTROY", typed: "DESTRO" })).toBe(false);
    expect(canConfirm({ ...base, phrase: "DESTROY", typed: "DESTROY" })).toBe(true);
  });

  it("requires both when both are set", () => {
    const rules = { ...base, requireReason: true, phrase: "GO" };
    expect(canConfirm({ ...rules, reason: "x".repeat(10), typed: "" })).toBe(false);
    expect(canConfirm({ ...rules, reason: "", typed: "GO" })).toBe(false);
    expect(canConfirm({ ...rules, reason: "x".repeat(10), typed: "GO" })).toBe(true);
  });
});

describe("toast store", () => {
  it("adds, defaults the tone and dismisses", () => {
    const id = toast({ title: "Saved" });
    expect(getToasts().find((item) => item.id === id)?.tone).toBe("info");
    dismissToast(id);
    expect(getToasts().some((item) => item.id === id)).toBe(false);
  });

  it("keeps only the newest few", () => {
    for (let i = 0; i < 10; i++) toast({ title: `n${i}`, tone: "success" });
    expect(getToasts().length).toBeLessThanOrEqual(4);
    expect(getToasts().at(-1)?.title).toBe("n9");
  });
});
