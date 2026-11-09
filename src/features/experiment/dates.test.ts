import { describe, expect, it } from "vitest";
import { experimentStatusOf, toDateInput } from "./dates";

describe("experiment dates", () => {
  it("turns a stored calendar day into a date input value without shifting the day", () => {
    expect(toDateInput(new Date("2026-03-04T00:00:00Z"))).toBe("2026-03-04");
    expect(toDateInput("2026-03-04T00:00:00.000Z")).toBe("2026-03-04");
    expect(toDateInput(null)).toBe("");
    expect(toDateInput("not a date")).toBe("");
  });

  it("is running until it is completed; completing sets the end date", () => {
    expect(experimentStatusOf(null)).toBe("active");
    expect(experimentStatusOf(new Date("2026-05-31T00:00:00Z"))).toBe("completed");
  });
});
