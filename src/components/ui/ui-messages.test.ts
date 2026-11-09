import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../messages");
const load = (locale: string): unknown =>
  JSON.parse(readFileSync(path.join(root, locale, "ui.json"), "utf8"));

/** `{ a: { b: "x" } }` -> `{ "a.b": "x" }` */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(result, flatten(child, prefix ? `${prefix}.${key}` : key));
  }
  return result;
}

/** Names of the top-level ICU arguments in a message: `{from, number}` -> "from". */
function placeholders(message: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (char === "{") {
      if (depth === 0) {
        const name = /^\{\s*([A-Za-z_]\w*)\s*[,}]/.exec(message.slice(i))?.[1];
        if (name) names.push(name);
      }
      depth++;
    } else if (char === "}") depth--;
  }
  return [...new Set(names)].sort();
}

const en = flatten(load("en"));
const fr = flatten(load("fr"));

describe("ui messages", () => {
  it("has the same keys in English and French", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it("uses the same ICU placeholders in every key", () => {
    for (const key of Object.keys(en)) {
      expect(placeholders(fr[key] ?? ""), key).toEqual(placeholders(en[key] ?? ""));
    }
  });

  it("extracts placeholders correctly", () => {
    expect(placeholders("{from, number}–{to, number} of {total, number}")).toEqual([
      "from",
      "to",
      "total",
    ]);
    expect(placeholders("No arguments")).toEqual([]);
  });

  it("has no empty strings and balanced braces", () => {
    for (const [locale, messages] of [
      ["en", en],
      ["fr", fr],
    ] as const) {
      for (const [key, message] of Object.entries(messages)) {
        expect(message.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
        expect(message.split("{").length, `${locale}:${key}`).toBe(message.split("}").length);
      }
    }
  });

  it("does not use straight apostrophes, which ICU treats as escape characters", () => {
    for (const [key, message] of Object.entries({ ...en, ...fr })) {
      expect(message.includes("'"), key).toBe(false);
    }
  });

  it("has the keys the primitives rely on", () => {
    for (const key of ["close", "cancel", "dismiss", "loading", "required", "previous", "next"]) {
      expect(en).toHaveProperty(key);
    }
  });
});
