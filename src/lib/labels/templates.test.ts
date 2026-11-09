import { describe, expect, it } from "vitest";
import { LABEL_TEMPLATE_IDS, LABEL_TEMPLATES, labelPositions, labelsPerPage } from "./templates";

describe("label templates", () => {
  it("fits every sheet's labels inside a Letter page", () => {
    for (const id of LABEL_TEMPLATE_IDS) {
      const t = LABEL_TEMPLATES[id];
      const right = t.origin.x + (t.columns - 1) * t.pitch.x + t.label.width;
      const bottom = t.origin.y + (t.rows - 1) * t.pitch.y + t.label.height;
      expect(right, id).toBeLessThanOrEqual(t.page.width + 0.01);
      expect(bottom, id).toBeLessThanOrEqual(t.page.height + 0.01);
    }
  });

  it("fills an Avery 5160 sheet across, then down, then on a new page", () => {
    const sheet = LABEL_TEMPLATES["avery-5160"];
    expect(labelsPerPage(sheet)).toBe(30);
    const positions = labelPositions(sheet, 32);
    expect(positions[0]).toEqual({ page: 0, x: 13.5, y: 36 });
    expect(positions[1]).toEqual({ page: 0, x: 13.5 + 198, y: 36 });
    expect(positions[3]).toEqual({ page: 0, x: 13.5, y: 36 + 72 });
    expect(positions[30]).toEqual({ page: 1, x: 13.5, y: 36 });
  });

  it("skips the used labels of a part-used sheet, but never on a roll", () => {
    const sheet = LABEL_TEMPLATES["avery-5163"];
    expect(labelPositions(sheet, 2, 9)).toEqual([
      { page: 0, x: sheet.origin.x + sheet.pitch.x, y: sheet.origin.y + 4 * sheet.pitch.y },
      { page: 1, x: sheet.origin.x, y: sheet.origin.y },
    ]);
    expect(labelPositions(LABEL_TEMPLATES["zebra-4x2"], 2, 5).map((p) => p.page)).toEqual([0, 1]);
  });
});
