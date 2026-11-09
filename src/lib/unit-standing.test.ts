import { describe, expect, it } from "vitest";
import { hasNothingLeft, unitStanding } from "./unit-standing";

describe("unitStanding", () => {
  it("is active without a hold or destruction", () => {
    expect(unitStanding("CREATED", null)).toBe("active");
    expect(unitStanding("MOVED", undefined)).toBe("active");
    expect(unitStanding(null, null)).toBe("active");
  });

  it("reports a unit with an open hold as on hold", () => {
    expect(unitStanding("MOVED", "HOLD")).toBe("on-hold");
  });

  it("lets destruction win over a leftover hold", () => {
    expect(unitStanding("DESTROYED", "HOLD")).toBe("destroyed");
  });

  it("does not treat shipping as a status: a unit that shipped is still active", () => {
    expect(unitStanding("SHIPPED_PART", null)).toBe("active");
    expect(unitStanding("SHIPPED", null)).toBe("active");
    expect(unitStanding("SHIPPED_PART", "HOLD")).toBe("on-hold");
  });
});

describe("hasNothingLeft", () => {
  it("is true only once a shipment took everything that was left", () => {
    expect(hasNothingLeft("SHIPPED")).toBe(true);
    // A plant group merged into another has nothing left either.
    expect(hasNothingLeft("MERGED")).toBe(true);
    expect(hasNothingLeft("SHIPPED_PART")).toBe(false);
    expect(hasNothingLeft("MOVED")).toBe(false);
    expect(hasNothingLeft(null)).toBe(false);
  });
});
