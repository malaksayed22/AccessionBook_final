import { describe, expect, it } from "vitest";
import { issueKey, ruleOrFieldMessage, type Translator } from "./api-error-text";

const catalog: Record<string, string> = {
  "reasons.moreThanLeftWet": "Only {left} g of {unit} left",
  "fields.humidWeight": "Wet weight",
  fieldIssue: "{field}: {problem}",
  "fieldIssues.tooSmall": "enter {minimum} or more.",
  "fieldIssues.required": "this is required.",
};

const translator = (locale: string): Translator => ({
  locale,
  has: (key) => key in catalog,
  message: (key, values = {}) =>
    (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? "")),
});

describe("ruleOrFieldMessage", () => {
  it("phrases a business rule in the reader's language, with its values", () => {
    const body = {
      params: { reason: "moreThanLeftWet", values: { left: 250, unit: "EXP33-001" } },
    };
    expect(ruleOrFieldMessage(body, translator("fr"))).toBe("Only 250 g of EXP33-001 left");
  });

  it("names the field a schema issue is about", () => {
    const body = { issues: [{ path: ["humidWeight"], code: "too_small", minimum: 0 }] };
    expect(ruleOrFieldMessage(body, translator("en"))).toBe("Wet weight: enter 0 or more.");
  });

  it("falls back to the server's sentence in English only, and never for an unknown field", () => {
    expect(ruleOrFieldMessage({ error: "Plain English rule" }, translator("en"))).toBe(
      "Plain English rule"
    );
    expect(ruleOrFieldMessage({ error: "Plain English rule" }, translator("fr"))).toBeUndefined();
    const unknownField = { error: "x: bad", issues: [{ path: ["mystery"], code: "custom" }] };
    expect(ruleOrFieldMessage(unknownField, translator("en"))).toBeUndefined();
  });
});

describe("issueKey", () => {
  it("reads an empty text field as missing, and a number below its minimum as too small", () => {
    expect(issueKey({ code: "too_small", origin: "string", minimum: 1 })).toBe("required");
    expect(issueKey({ code: "too_small", origin: "number", minimum: 0 })).toBe("tooSmall");
    expect(issueKey({ code: "invalid_type" })).toBe("required");
    expect(issueKey({ code: "custom" })).toBe("invalid");
  });
});
