import { describe, expect, it } from "vitest";
import { hiddenColumns, normalizeViewQuery, toggleColumn } from "./table-view";

describe("table views", () => {
  it("hides only the columns a list lets a member hide", () => {
    expect(hiddenColumns("cultivar, name,location,cultivar", ["cultivar", "location"])).toEqual([
      "cultivar",
      "location",
    ]);
    expect(hiddenColumns(undefined, ["cultivar"])).toEqual([]);
  });

  it("toggles a column", () => {
    expect(toggleColumn(["cultivar"], "location")).toEqual(["cultivar", "location"]);
    expect(toggleColumn(["cultivar", "location"], "cultivar")).toEqual(["location"]);
  });

  it("saves a query without its page, in a stable order", () => {
    expect(normalizeViewQuery("?status=hold&page=3&q=&group=location&hide=cultivar")).toBe(
      "group=location&hide=cultivar&status=hold"
    );
  });
});
