import { z } from "zod";
import { HoldKind, IncidentSeverity, IncidentStatus, TestPanel } from "@/generated/prisma/enums";
import { idSchema } from "@/features/unit/schemas";

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    schema.optional()
  );
}
const text = (max: number) => z.string().trim().max(max);
const number = z.coerce.number().finite().min(-1e12).max(1e12);
const grams = z.coerce.number().finite().min(0).max(1e9);

export const recordLabTestSchema = z.object({
  panel: z.enum(TestPanel),
  analyte: optional(text(120)),
  value: optional(number),
  uom: optional(text(40)),
  wetWeight: optional(grams),
  dryWeight: optional(grams),
  labName: optional(text(200)),
  testedAt: optional(text(40)),
  comment: optional(text(2000)),
  /** The tissue sample of the unit the result is for, when it was tested on one. */
  tissueSampleId: optional(idSchema),
});
export type RecordLabTestInput = z.infer<typeof recordLabTestSchema>;

export const placeHoldSchema = z.object({
  reason: text(2000).min(3, "A hold reason is required"),
  kind: z.preprocess((v) => v ?? HoldKind.HOLD, z.enum(HoldKind)),
});
export type PlaceHoldInput = z.infer<typeof placeHoldSchema>;

export const releaseHoldSchema = z.object({
  note: text(2000).min(3, "A reason for releasing the hold is required"),
});
export type ReleaseHoldInput = z.infer<typeof releaseHoldSchema>;

export const openIncidentSchema = z.object({
  title: text(200).min(1, "Title is required"),
  description: text(5000).min(1, "Description is required"),
  severity: z.preprocess((v) => v ?? IncidentSeverity.MAJOR, z.enum(IncidentSeverity)),
  unitId: optional(idSchema),
  cultivarId: optional(idSchema),
  experimentId: optional(idSchema),
});
export type OpenIncidentInput = z.infer<typeof openIncidentSchema>;

export const updateIncidentSchema = z
  .object({
    status: optional(z.enum(IncidentStatus)),
    resolution: optional(text(5000)),
    /** The procedure it departed from; null clears it. */
    sopId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
  })
  .refine(
    (v) => v.status !== undefined || v.resolution !== undefined || v.sopId !== undefined,
    "Nothing to update"
  );
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

export const voidRecordSchema = z.object({
  reason: text(2000).min(3, "A reason for voiding is required"),
});
export type VoidRecordInput = z.infer<typeof voidRecordSchema>;

// --- Corrective and preventive actions ---------------------------------------------------------

const note = (message: string) => z.string().trim().min(3, message).max(2000);

export const capaCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    kind: z.enum(["CORRECTIVE", "PREVENTIVE"]),
    description: note("Say what is to be done"),
    ownerId: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().int().positive().optional()
    ),
    dueDate: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    ),
  }),
  z.object({
    action: z.literal("complete"),
    capaId: z.coerce.number().int().positive(),
    note: note("Say what was done"),
  }),
  z.object({
    action: z.literal("verify"),
    capaId: z.coerce.number().int().positive(),
    note: note("Say how you checked it worked"),
  }),
]);
export type CapaCommand = z.infer<typeof capaCommandSchema>;
