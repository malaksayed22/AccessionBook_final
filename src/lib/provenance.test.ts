import { describe, expect, it } from "vitest";
import { findProvenanceIssue, validateProvenance } from "./provenance";

describe("provenance", () => {
  it("needs a source type, then a supplier or a description of at least 10 characters", () => {
    expect(findProvenanceIssue({})).toBe("source_type_required");
    expect(findProvenanceIssue({ sourceType: "SEED" })).toBe("source_required");
    expect(findProvenanceIssue({ sourceType: "SEED", sourceDescription: "short" })).toBe(
      "source_description_short"
    );
    expect(
      findProvenanceIssue({ sourceType: "SEED", sourceDescription: "From the 2024 harvest" })
    ).toBeNull();
    expect(findProvenanceIssue({ sourceType: "RECEIVED", providerOrganizationId: 3 })).toBeNull();
  });

  it("keeps the English messages the API returns", () => {
    expect(validateProvenance({})).toBe("Material source type is required");
    expect(validateProvenance({ sourceType: "SEED" })).toBe(
      "Describe the source (internal stock, older unit, origin) or select an external provider"
    );
    expect(validateProvenance({ sourceType: "SEED", sourceDescription: "x" })).toBe(
      "Source description must be at least 10 characters when no provider is listed"
    );
    expect(
      validateProvenance({ sourceType: "OTHER", sourceDescription: "Long enough text" })
    ).toBeNull();
  });
});
