import { z } from "zod";
import { idSchema } from "@/features/unit/schemas";
import { MAX_GROUP_QUANTITY } from "@/lib/experiment-intake";

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    schema.optional()
  );
}
const text = (max: number) => z.string().trim().max(max);
/** No product limit on a group's size; this only keeps one request within what a transaction can write. */
const quantity = z.coerce.number().int().min(0).max(MAX_GROUP_QUANTITY);
const amount = z.coerce.number().min(0).max(1e9);

const intakeGroupSchema = z.object({
  kind: text(40).min(1),
  cultivarId: optional(idSchema),
  cultivarMode: z.preprocess((v) => (v === "MIXED" ? "MIXED" : "SAME"), z.enum(["SAME", "MIXED"])),
  cultivarBreakdown: z
    .array(z.object({ cultivarId: idSchema, count: quantity }))
    .max(200)
    .optional(),
  quantity,
  statusMode: z.preprocess((v) => (v === "MIXED" ? "MIXED" : "SAME"), z.enum(["SAME", "MIXED"])),
  status: optional(text(40)),
  breakdown: z
    .array(z.object({ status: text(40).min(1), count: quantity }))
    .max(50)
    .optional(),
  seedsPerLot: optional(z.coerce.number().int().min(0).max(1e9)),
  wetWeightGrams: optional(amount),
  dryWeightGrams: optional(amount),
});

export const createExperimentSchema = z.object({
  name: text(200).min(1, "Experiment name is required"),
  startDate: text(40).min(1, "Start date is required"),
  comment: optional(text(2000)),
  /** Optional estimate of the day it will be completed. */
  estimatedEndDate: optional(text(40)),
  parentExperimentId: optional(idSchema),
  sourceUnitId: optional(idSchema),
  /** Honoured for admins only: additional members to add besides the lead. */
  memberIds: z.array(idSchema).max(100).optional(),
  locationId: optional(idSchema),
  /** Where the material came from. Always chosen: internal lab stock, or an external supplier. */
  providerMode: z.enum(["INTERNAL", "EXTERNAL"]),
  providerOrganizationId: optional(idSchema),
  sourceDescription: optional(text(2000)),
  unitGroups: z.array(intakeGroupSchema).max(50).optional(),
  createReceipt: z.boolean().optional(),
  ignoreCapacityWarning: z.boolean().optional(),
});
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;

export const experimentMemberSchema = z.object({ userId: idSchema });
export const updateExperimentSchema = z
  .object({
    name: optional(text(200).min(1)),
    comment: z.preprocess((v) => (v === null ? "" : v), text(2000).optional()),
    /** A day, or empty to clear the estimate. */
    estimatedEndDate: z.preprocess((v) => (v === null ? "" : v), text(40).optional()),
    /** Administrators only: correct the start day, or the day a completed experiment was completed. */
    startDate: optional(text(40)),
    endDate: optional(text(40)),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");
export type UpdateExperimentInput = z.infer<typeof updateExperimentSchema>;

/** Completing sets the end date: the day the experiment finished (today when left empty). */
export const completeExperimentSchema = z.object({ endDate: optional(text(40)) });
export type CompleteExperimentInput = z.infer<typeof completeExperimentSchema>;

export const uploadExperimentDocumentFieldsSchema = z.object({
  label: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(200).optional()
  ),
});
