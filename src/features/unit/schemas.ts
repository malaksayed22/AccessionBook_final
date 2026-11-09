import { z } from "zod";
import {
  ActivityType,
  AttachmentCategory,
  GrowthStage,
  HoldKind,
  SampleKind,
  SourceType,
  WasteType,
  UnitType,
} from "@/generated/prisma/enums";

/** Ids arrive as JSON numbers or numeric strings (form selects); both are accepted. */
export const idSchema = z.coerce.number().int().positive();

/** Empty string, null and undefined all mean "not provided". */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    schema.optional()
  );
}

const text = (max: number) => z.string().trim().max(max);

/** Grams, three decimals, never negative. */
const grams = z.coerce.number().finite().min(0).max(1_000_000_000);
const count = z.coerce.number().int().min(0).max(1_000_000_000);

/** `YYYY-MM-DD` or a full ISO timestamp; resolved against the lab time zone by the service. */
const effectiveAt = optional(text(40));

export const registerUnitSchema = z.object({
  type: z.enum(UnitType),
  /** The unit's name; with `quantity > 1` it is the base name (`BASE-1`, `BASE-2` …). */
  name: text(120).min(1, "Unit name is required"),
  quantity: z.preprocess((v) => v ?? 1, z.coerce.number().int().min(1).max(50)),
  /** Plants held by each plant unit (a plant group); one when not given. */
  plantCount: optional(z.coerce.number().int().min(1).max(100_000)),
  experimentId: idSchema,
  cultivarId: idSchema,
  locationId: idSchema,
  sex: optional(text(40)),
  comment: optional(text(2000)),
  growthStage: optional(z.enum(GrowthStage)),
  seedCount: optional(count),
  humidWeight: optional(grams),
  dryWeight: optional(grams),
  sourceType: z.enum(SourceType),
  sourceDescription: optional(text(2000)),
  providerOrganizationId: optional(idSchema),
  sourceParentUnitId: optional(idSchema),
  effectiveAt,
});
export type RegisterUnitInput = z.infer<typeof registerUnitSchema>;

export const deriveUnitSchema = z.object({
  deriveType: z.enum(["clone", "subculture", "cutting"]),
  name: optional(text(120)),
  quantity: z.preprocess((v) => v ?? 1, z.coerce.number().int().min(1).max(50)),
  locationId: optional(idSchema),
  experimentId: optional(idSchema),
  /** Put the new units in a new experiment (a sub-experiment of the parent's) instead of the parent's. */
  newExperiment: optional(z.object({ name: text(200).min(1) })),
  growthStage: optional(z.enum(GrowthStage)),
  comment: optional(text(2000)),
});
export type DeriveUnitInput = z.infer<typeof deriveUnitSchema>;

export const moveUnitSchema = z.object({
  toLocationId: idSchema,
  /** A scan of the unit's barcode. When present it must match; its presence marks the move scan-confirmed. */
  barcode: optional(text(200)),
  comment: optional(text(2000)),
});
export type MoveUnitInput = z.infer<typeof moveUnitSchema>;

export const changeStageSchema = z.object({
  toStage: z.enum(GrowthStage),
  effectiveAt,
  comment: optional(text(2000)),
});
export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const measureUnitSchema = z
  .object({
    humidWeight: optional(grams),
    dryWeight: optional(grams),
    seedCount: optional(count),
    effectiveAt,
    comment: optional(text(2000)),
  })
  .refine(
    (v) => v.humidWeight !== undefined || v.dryWeight !== undefined || v.seedCount !== undefined,
    "Provide a weight or a seed count"
  );
export type MeasureUnitInput = z.infer<typeof measureUnitSchema>;

export const destroyUnitSchema = z.object({
  reason: text(2000).min(3, "A reason for destruction is required"),
  effectiveAt,
});
export type DestroyUnitInput = z.infer<typeof destroyUnitSchema>;

const activityFields = z.object({
  type: z.enum(ActivityType),
  title: text(200).min(1, "A title is required"),
  details: optional(text(5000)),
  product: optional(text(200)),
  pcpNumber: optional(text(40)),
  amount: optional(z.coerce.number().finite().positive().max(1_000_000_000)),
  amountUnit: optional(text(20)),
  method: optional(text(200)),
  effectiveAt,
});

/** Activities that put something on the plants name it, and how much was used. */
export const PRODUCT_ACTIVITIES: ReadonlySet<ActivityType> = new Set([
  ActivityType.PESTICIDE,
  ActivityType.BENEFICIAL_INSECTS,
]);

/**
 * A pest-control application is recorded with the product, its Pest Control Products Act registration
 * number and the amount used; a release of beneficial insects with the species and how many.
 */
function checkActivity(value: z.infer<typeof activityFields>, ctx: z.RefinementCtx) {
  const issue = (field: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [field], message });
  if (PRODUCT_ACTIVITIES.has(value.type)) {
    if (!value.product) issue("product", "Name the product or species applied");
    if (value.amount === undefined) issue("amount", "Say how much was applied");
  }
  if (value.type === ActivityType.PESTICIDE && !value.pcpNumber) {
    issue("pcpNumber", "A pest control product needs its PCP registration number");
  }
  if (value.amount !== undefined && !value.amountUnit) issue("amountUnit", "Give the unit");
}

export const recordActivitySchema = activityFields.superRefine(checkActivity);
export type RecordActivityInput = z.infer<typeof recordActivitySchema>;

/**
 * Part of a flower (grams, on the basis it is weighed on) or of a seed lot (seeds) taken as a sample.
 * The sample becomes a unit of its own, in the parent's location unless another is chosen.
 */
export const takeSampleSchema = z.object({
  kind: z.enum(SampleKind),
  amount: z.coerce.number().finite().positive().max(1_000_000_000),
  locationId: optional(idSchema),
  comment: optional(text(2000)),
});
export type TakeSampleInput = z.infer<typeof takeSampleSchema>;

/**
 * Part of a weighed flower or harvested plant disposed of as waste, in grams on the basis the unit is
 * weighed on. `method` says how it was disposed of (rendered unusable, composted…).
 */
export const recordWasteSchema = z.object({
  type: z.enum(WasteType),
  amount: z.coerce.number().finite().positive().max(1_000_000_000),
  method: text(500).min(3, "Say how the waste was disposed of"),
  comment: optional(text(2000)),
  effectiveAt,
});
export type RecordWasteInput = z.infer<typeof recordWasteSchema>;

/** Plants split off from a plant group into a new group, optionally in another location. */
export const splitGroupSchema = z.object({
  plants: z.coerce.number().int().min(1).max(100_000),
  locationId: optional(idSchema),
  comment: optional(text(2000)),
});
export type SplitGroupInput = z.infer<typeof splitGroupSchema>;

/** A whole plant group joins another (same experiment, cultivar and stage). */
export const mergeGroupSchema = z.object({
  intoUnitId: idSchema,
  comment: optional(text(2000)),
});
export type MergeGroupInput = z.infer<typeof mergeGroupSchema>;

/** Most units one bulk action may touch. */
export const BULK_MAX = 100;
const bulkIds = z.array(idSchema).min(1).max(BULK_MAX);

/**
 * One action applied to several units, all or nothing. The values are the same as the single-unit
 * forms take, except a move needs no barcode scan (a scan confirms one unit in hand).
 */
export const bulkUnitsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    unitIds: bulkIds,
    toLocationId: idSchema,
    comment: optional(text(2000)),
  }),
  changeStageSchema.extend({ action: z.literal("stage"), unitIds: bulkIds }),
  z.object({
    action: z.literal("hold"),
    unitIds: bulkIds,
    reason: text(2000).min(3, "A hold reason is required"),
  }),
  destroyUnitSchema.extend({ action: z.literal("destroy"), unitIds: bulkIds }),
  z.object({
    action: z.literal("release"),
    unitIds: bulkIds,
    reason: text(2000).min(10, "A reason for releasing the hold is required"),
  }),
  activityFields
    .extend({ action: z.literal("activity"), unitIds: bulkIds })
    .superRefine(checkActivity),
]);
export type BulkUnitsInput = z.infer<typeof bulkUnitsSchema>;

export const updateUnitDetailsSchema = z
  .object({
    comment: z.preprocess((v) => (v === "" ? null : v), text(2000).nullish()),
    sex: z.preprocess((v) => (v === "" ? null : v), text(40).nullish()),
  })
  .refine((v) => v.comment !== undefined || v.sex !== undefined, "Nothing to update");
export type UpdateUnitDetailsInput = z.infer<typeof updateUnitDetailsSchema>;

export const linkParentSchema = z.object({
  parentUnitId: idSchema,
  comment: optional(text(2000)),
});
export type LinkParentInput = z.infer<typeof linkParentSchema>;

export const uploadAttachmentFieldsSchema = z.object({
  label: text(200).min(1, "A label is required"),
  category: z.enum(AttachmentCategory),
});

export const voidAttachmentSchema = z.object({
  reason: text(2000).min(3, "A reason for removing the document is required"),
});
export type VoidAttachmentInput = z.infer<typeof voidAttachmentSchema>;

/** Body of `POST /api/units/:id/hold`: place a hold (with its reason) or release one (with why). */
export const holdRequestSchema = z.object({
  action: z.enum(["hold", "release"]),
  // Placing: the reason for the hold. Releasing: why it is safe to release.
  reason: text(2000).optional(),
  note: text(2000).optional(),
  kind: z.enum(HoldKind).optional(),
});

const gramsOrBlank = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().finite().min(0).max(1e9).optional()
);

/** Fields the unit edit form can send together; applied atomically as proper events. */
export const patchUnitSchema = z.object({
  comment: z.unknown().optional(),
  sex: z.unknown().optional(),
  plant: z.object({ humidWeight: gramsOrBlank, dryWeight: gramsOrBlank }).optional(),
  tracking: z
    .object({
      growthStage: z.preprocess((v) => (v === "" ? undefined : v), z.enum(GrowthStage).nullish()),
      seedCount: z.preprocess(
        (v) => (v === "" || v === null ? undefined : v),
        z.coerce.number().int().min(0).max(1e9).optional()
      ),
      humidWeight: gramsOrBlank,
      dryWeight: gramsOrBlank,
      locationId: optional(idSchema),
    })
    .optional(),
});

/** The tissue a tissue sample is cut from. */
export const TISSUE_KINDS = ["LEAF", "PETIOLE", "ROOT", "MERISTEM", "MEDIUM", "OTHER"] as const;
export type TissueKind = (typeof TISSUE_KINDS)[number];

export const takeTissueSampleSchema = z.object({
  purpose: z.enum(["PATHOGEN", "SEX", "IDENTITY", "OTHER"]),
  tissue: z.enum(TISSUE_KINDS),
  note: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().trim().max(2000).optional()
  ),
});
export type TakeTissueSampleInput = z.infer<typeof takeTissueSampleSchema>;
