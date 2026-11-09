import { z } from "zod";

const text = (max: number) =>
  z.preprocess((v) => (v === null ? "" : v), z.string().trim().max(max));
const name = text(120).pipe(z.string().min(2, "Cultivar name is required"));

/** A percentage from 0 to 100, one decimal at most; empty text or null clears it. */
const percent = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce.number().min(0).max(100).nullable()
);

/** Whole days, up to a year; empty text or null clears it. */
const days = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce.number().int().min(1).max(365).nullable()
);
/** Grams per plant; empty text or null clears it. */
const yieldGrams = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce.number().positive().max(100_000).nullable()
);

export const createCultivarSchema = z.object({
  name,
  commonName: text(120).optional(),
  category: text(60).optional(),
  targetThc: percent.optional(),
  targetCbd: percent.optional(),
  vegetativeDays: days.optional(),
  floweringDays: days.optional(),
  expectedYieldGrams: yieldGrams.optional(),
  comment: text(2000).optional(),
});
export type CreateCultivarInput = z.infer<typeof createCultivarSchema>;

export const updateCultivarSchema = z.object({
  name: name.optional(),
  commonName: text(120).optional(),
  category: text(60).optional(),
  targetThc: percent.optional(),
  targetCbd: percent.optional(),
  vegetativeDays: days.optional(),
  floweringDays: days.optional(),
  expectedYieldGrams: yieldGrams.optional(),
  comment: text(2000).optional(),
});
export type UpdateCultivarInput = z.infer<typeof updateCultivarSchema>;
