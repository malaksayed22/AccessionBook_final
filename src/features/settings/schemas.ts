import { z } from "zod";

const text = (max: number) =>
  z.preprocess((v) => (v === null ? "" : v), z.string().trim().max(max));

export const updateLabSettingsSchema = z.object({
  licenceNumber: text(60).optional(),
  licenceHolder: text(200).optional(),
  licenceClass: z
    .preprocess(
      (v) => (v === "" ? null : v),
      z
        .enum(["CULTIVATION", "PROCESSING", "ANALYTICAL_TESTING", "RESEARCH", "MEDICAL_SALES"])
        .nullable()
    )
    .optional(),
  siteAddress: text(500).optional(),
  backdateLimitDays: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.coerce.number().int().min(1).max(3650).nullable()
    )
    .optional(),
  experimentCodePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, "Two to six letters")
    .optional(),
});
export type UpdateLabSettingsInput = z.infer<typeof updateLabSettingsSchema>;
