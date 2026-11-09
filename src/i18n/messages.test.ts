import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_AREAS } from "./messages";

/**
 * English is the reference. French must have exactly the same keys and the same {placeholders},
 * and may not leave a sentence in English. Run in CI, so a missing translation fails the build.
 */
const ROOT = path.resolve(import.meta.dirname, "../../messages");

type Tree = { [key: string]: string | Tree };

const load = (locale: string, area: string): Tree =>
  JSON.parse(readFileSync(path.join(ROOT, locale, `${area}.json`), "utf8"));

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}

/** Variable names used by an ICU message, e.g. `{count, plural, ...}` -> "count". */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  // Plural and select branches ("one {unit} other {units}") hold words, not variables: drop their text
  // (keeping any placeholders inside them, e.g. "one {# unit}" has none, "one {{names} created}" has one).
  let flattened = message;
  for (let i = 0; i < 4; i++) {
    flattened = flattened.replace(/\b(?:zero|one|two|few|many|other|=\d+)\s*\{([^{}]*)\}/g, " $1 ");
  }
  for (const match of flattened.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)) {
    names.add(match[1]!);
  }
  // Rich-text tags, e.g. <strong>...</strong>.
  for (const match of message.matchAll(/<([a-z]+)>/g)) names.add(`<${match[1]}>`);
  return [...names].sort();
}

/** Text that is legitimately identical in both languages (names, acronyms, product terms). */
const SAME_IN_BOTH = new Set(["language.en", "language.fr", "nav.items.cultivars.label"]);

describe.each(MESSAGE_AREAS)("messages: %s", (area) => {
  const en = flatten(load("en", area));
  const fr = flatten(load("fr", area));

  it("has the same keys in English and French", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the same placeholders in every message", () => {
    for (const [key, message] of Object.entries(en)) {
      expect(placeholders(fr[key] ?? ""), key).toEqual(placeholders(message));
    }
  });

  it("has no empty messages", () => {
    for (const [key, message] of [...Object.entries(en), ...Object.entries(fr)]) {
      expect(message.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("does not leave French sentences in English", () => {
    for (const [key, message] of Object.entries(en)) {
      const words = message
        .replace(/\{[^}]*\}/g, "")
        .split(/\s+/)
        .filter(Boolean).length;
      if (words < 3 || SAME_IN_BOTH.has(key)) continue;
      expect(fr[key], `${area}.${key} looks untranslated`).not.toBe(message);
    }
  });

  it("uses typographic apostrophes in French", () => {
    for (const [key, message] of Object.entries(fr)) {
      expect(message, key).not.toMatch(/[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/);
    }
  });
});

describe("client message payload", () => {
  it("never sends an area to the browser that a client component reads", async () => {
    const { SERVER_ONLY_AREAS } = await import("./messages");
    const { readdirSync, statSync } = await import("node:fs");
    const root = path.resolve(import.meta.dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(full)) files.push(full);
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/^["']use client["']/m.test(source.slice(0, 200))) continue;
      for (const area of SERVER_ONLY_AREAS) {
        if (new RegExp(`useTranslations\\("${area}[".]`).test(source))
          offenders.push(`${file}: ${area}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
