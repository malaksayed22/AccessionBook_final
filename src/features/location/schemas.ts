import { z } from "zod";

const text = (max: number) =>
  z.preprocess((v) => (v === null ? "" : v), z.string().trim().max(max));
const name = text(120).pipe(z.string().min(2, "Location name is required"));

/** A whole number (units, plants or grams), or null for "no limit". Empty form text means no limit. */
const capacity = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce.number().int().min(1).max(1_000_000).nullable()
);

/** A room's short code (R-101, VEG-2): letters, digits and dashes, kept in capitals. */
const code = z
  .string()
  .trim()
  .min(1, "A room code is required")
  .max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "Use letters, digits and dashes")
  .transform((v) => v.toUpperCase());
const capacityMeasure = z.enum(["UNITS", "PLANTS", "WEIGHT"]);

/**
 * A location is a room: a name, a code and a description; no levels inside it. The code is made by
 * the server (R-012, the next free number) unless a caller such as a script names one.
 */
export const createLocationSchema = z.object({
  name,
  code: code.optional(),
  address: text(500).optional(),
  comment: text(2000).optional(),
  capacity: capacity.optional(),
  capacityMeasure: capacityMeasure.optional(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z.object({
  name: name.optional(),
  code: code.optional(),
  address: text(500).optional(),
  comment: text(2000).optional(),
  capacity: capacity.optional(),
  capacityMeasure: capacityMeasure.optional(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const REASON_MIN_LENGTH = 10;
const reason = z.string().trim().min(REASON_MIN_LENGTH).max(500);

/** `PATCH /api/locations/:id`: edit the details, or retire / bring back a location. */
export const locationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update") }).extend(updateLocationSchema.shape),
  z.object({ action: z.literal("retire"), reason }),
  z.object({ action: z.literal("reactivate") }),
]);
export type LocationCommand = z.infer<typeof locationCommandSchema>;
