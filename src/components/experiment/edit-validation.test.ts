import { describe, expect, it } from "vitest";
import { validateEdit, type EditDraft } from "./edit-validation";

const ok: EditDraft = {
  name: "Trial",
  comment: "",
  estimatedEndDate: "",
  startDate: "2026-03-01",
  endDate: "",
};
const member = { isAdmin: false, today: "2026-06-01" };
const admin = { isAdmin: true, today: "2026-06-01" };

describe("validateEdit", () => {
  it("accepts a valid edit", () => {
    expect(validateEdit(ok, member)).toEqual({});
    expect(validateEdit(ok, admin)).toEqual({});
  });

  it("requires a name within the limit", () => {
    expect(validateEdit({ ...ok, name: "  " }, member).name).toBe("name_required");
    expect(validateEdit({ ...ok, name: "x".repeat(201) }, member).name).toBe("name_too_long");
  });

  it("limits the notes", () => {
    expect(validateEdit({ ...ok, comment: "x".repeat(2001) }, member).comment).toBe(
      "comment_too_long"
    );
  });

  it("keeps an estimated end on or after the start", () => {
    expect(validateEdit({ ...ok, estimatedEndDate: "2026-09-01" }, member)).toEqual({});
    expect(validateEdit({ ...ok, estimatedEndDate: "2026-02-01" }, member).estimatedEndDate).toBe(
      "estimate_before_start"
    );
    expect(validateEdit({ ...ok, estimatedEndDate: "soon" }, member).estimatedEndDate).toBe(
      "date_invalid"
    );
  });

  it("lets only administrators correct the start and completion days, within the rules", () => {
    const done = { ...ok, endDate: "2026-05-01" };
    expect(validateEdit(done, admin)).toEqual({});
    expect(validateEdit({ ...done, endDate: "2026-02-01" }, admin).endDate).toBe(
      "end_before_start"
    );
    expect(validateEdit({ ...done, endDate: "2026-07-01" }, admin).endDate).toBe("end_in_future");
    expect(validateEdit({ ...done, startDate: "" }, admin).startDate).toBe("date_invalid");
    // A member's draft never checks them: those fields are read-only for a member.
    expect(validateEdit({ ...done, endDate: "2026-02-01", startDate: "" }, member)).toEqual({});
  });
});
