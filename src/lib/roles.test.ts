import { describe, expect, it } from "vitest";
import {
  canManageLocations,
  canReadCompliance,
  isQuality,
  isReadOnly,
  refusedAsReadOnly,
  ROLES,
  seesWholeLab,
  worksOnAllUnits,
  type Role,
} from "./roles";

const as = (permissions: Role) => ({ permissions });
const who = (rule: (user: { permissions: Role }) => boolean) =>
  ROLES.filter((role) => rule(as(role)));

describe("roles", () => {
  it("lets every role but a member see the whole laboratory", () => {
    expect(who(seesWholeLab)).toEqual(["ADMIN", "QA", "INVENTORY", "INSPECTOR"]);
  });

  it("gives each role its own part of the work", () => {
    expect(who(canReadCompliance)).toEqual(["ADMIN", "QA", "INSPECTOR"]);
    expect(who(isQuality)).toEqual(["ADMIN", "QA"]);
    expect(who(worksOnAllUnits)).toEqual(["ADMIN", "INVENTORY"]);
    expect(who(canManageLocations)).toEqual(["ADMIN", "INVENTORY"]);
    expect(who(isReadOnly)).toEqual(["INSPECTOR"]);
  });

  it("refuses an inspector's changes, but not reads, their own sign-in or their saved views", () => {
    const inspector = as("INSPECTOR");
    expect(refusedAsReadOnly(inspector, "POST", "/api/units/4/hold")).toBe(true);
    expect(refusedAsReadOnly(inspector, "patch", "/api/experiments/2")).toBe(true);
    expect(refusedAsReadOnly(inspector, "DELETE", "/api/units/4/attachments/1")).toBe(true);
    expect(refusedAsReadOnly(inspector, "GET", "/api/reports/ctls-monthly")).toBe(false);
    expect(refusedAsReadOnly(inspector, "POST", "/api/auth/logout")).toBe(false);
    expect(refusedAsReadOnly(inspector, "PATCH", "/api/auth/profile")).toBe(false);
    // Their own saved views of lists are theirs to keep.
    expect(refusedAsReadOnly(inspector, "POST", "/api/views")).toBe(false);
    expect(refusedAsReadOnly(inspector, "DELETE", "/api/views/3")).toBe(false);
    for (const role of ["ADMIN", "REGULAR", "QA", "INVENTORY"] as const) {
      expect(refusedAsReadOnly(as(role), "POST", "/api/units/4/hold")).toBe(false);
    }
  });
});
