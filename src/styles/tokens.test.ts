import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Colour contrast is a compliance requirement here (WCAG 2.2 AA), so it is a test, not a review
 * comment. The tokens are parsed straight from tokens.css, so the file cannot drift from the check.
 */
const css = readFileSync(path.resolve(import.meta.dirname, "tokens.css"), "utf8");

type Rgba = { r: number; g: number; b: number; a: number };
type Palette = Record<string, string>;

function declarations(block: string): Palette {
  const result: Palette = {};
  for (const match of block.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
    result[match[1]!] = match[2]!.trim();
  }
  return result;
}

/** Text of the first balanced `{ ... }` after `marker`. */
function blockAfter(marker: string): string {
  const start = css.indexOf("{", css.indexOf(marker));
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start + 1, i);
  }
  throw new Error(`unbalanced block after ${marker}`);
}

const light = declarations(blockAfter("@theme static"));
const darkMedia = declarations(blockAfter(':root:not([data-theme="light"])'));
const darkForced = declarations(blockAfter(':root[data-theme="dark"]'));
const dark = { ...light, ...darkForced };

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
  if (rgba) return { r: +rgba[1]!, g: +rgba[2]!, b: +rgba[3]!, a: rgba[4] ? +rgba[4] : 1 };
  throw new Error(`cannot parse colour ${value}`);
}

const over = (top: Rgba, base: Rgba): Rgba => ({
  r: top.r * top.a + base.r * (1 - top.a),
  g: top.g * top.a + base.g * (1 - top.a),
  b: top.b * top.a + base.b * (1 - top.a),
  a: 1,
});

const luminance = ({ r, g, b }: Rgba) => {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
};

function contrast(palette: Palette, foreground: string, background: string, under = "surface") {
  const base = parse(palette[`--color-${under}`]!);
  const bg = over(parse(palette[`--color-${background}`]!), base);
  const fg = over(parse(palette[`--color-${foreground}`]!), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = ["bg", "surface", "raised", "sunken", "hover"];
const STATUSES = ["success", "warning", "danger", "info"];

// [foreground, backgrounds, minimum ratio]
const PAIRS: Array<[string, string[], number]> = [
  ["fg", SURFACES, 4.5],
  ["fg-secondary", SURFACES, 4.5],
  ["fg-tertiary", [...SURFACES, "accent-soft", "neutral-soft"], 4.5],
  ["accent-text", [...SURFACES, "accent-soft"], 4.5],
  ["on-accent", ["accent", "accent-hover"], 4.5],
  ...STATUSES.map((s): [string, string[], number] => [s, [...SURFACES, `${s}-soft`], 4.5]),
  // Non-text: control boundaries and keyboard focus (WCAG 1.4.11).
  ["border-input", ["bg", "surface", "raised", "sunken"], 3],
  // Chart marks (non-text, WCAG 1.4.11). Categorical slot 3 on the light surface is documented below.
  ["chart-accent", ["surface", "raised"], 3],
  ["chart-1", ["surface", "raised"], 3],
  ["chart-2", ["surface", "raised"], 3],
  ["success-solid", ["surface", "raised"], 3],
  ["danger-solid", ["surface", "raised"], 3],
  ["warning-solid", ["surface", "raised"], 3],
  ["focus", ["bg", "surface", "raised", "sunken"], 3],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme meets WCAG 2.2 AA", (_name, palette) => {
  for (const [foreground, backgrounds, minimum] of PAIRS) {
    for (const background of backgrounds) {
      it(`${foreground} on ${background} is at least ${minimum}:1`, () => {
        expect(contrast(palette, foreground, background)).toBeGreaterThanOrEqual(minimum);
      });
    }
  }
});

describe("chart colours", () => {
  it("slot 3 meets 3:1 in dark; in light it is the documented exception (legend and table view required)", () => {
    expect(contrast(dark, "chart-3", "surface")).toBeGreaterThanOrEqual(3);
    expect(contrast(light, "chart-3", "surface")).toBeGreaterThanOrEqual(2.5);
    // Slot 4 (yellow) is only for adjacent-slice forms with a legend and a table view.
    expect(contrast(dark, "chart-4", "surface")).toBeGreaterThanOrEqual(3);
    expect(contrast(light, "chart-4", "surface")).toBeGreaterThanOrEqual(2);
  });
});

describe("token file consistency", () => {
  it("defines the same tokens in light and dark", () => {
    expect(Object.keys(darkForced).sort()).toEqual(Object.keys(darkMedia).sort());
    const overridden = Object.keys(darkForced).filter((key) => !(key in light));
    expect(overridden).toEqual([]);
  });

  it("keeps the system-dark block identical to the forced-dark block", () => {
    expect(darkMedia).toEqual(darkForced);
  });
});
