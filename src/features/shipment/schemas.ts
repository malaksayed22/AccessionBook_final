import { z } from "zod";
import {
  MaterialClass,
  Moisture,
  ShipmentDirection,
  ShipmentStatus,
} from "@/generated/prisma/enums";
import { idSchema } from "@/features/unit/schemas";

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    schema.optional()
  );
}
const text = (max: number) => z.string().trim().max(max);

export const shipmentItemSchema = z.object({
  unitId: optional(idSchema),
  cultivarId: optional(idSchema),
  description: text(300).min(1, "Every line needs a description"),
  materialType: z.enum(MaterialClass),
  unitCount: optional(z.coerce.number().min(0).max(1e9)),
  weightGrams: optional(z.coerce.number().min(0).max(1e9)),
  moisture: optional(z.enum(Moisture)),
  comment: optional(text(1000)),
  /** A part of the unit rather than all of it (unit lines only). */
  isPart: optional(z.boolean()),
});
export type ShipmentItemInput = z.infer<typeof shipmentItemSchema>;

const dateText = optional(text(40));

export const createShipmentSchema = z.object({
  direction: z.enum(ShipmentDirection),
  organizationId: idSchema,
  status: optional(
    z.enum([ShipmentStatus.DRAFT, ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED])
  ),
  shippedDate: dateText,
  deliveredDate: dateText,
  trackingNumber: optional(text(200)),
  licenceNumber: optional(text(100)),
  comment: optional(text(2000)),
  items: z.array(shipmentItemSchema).min(1, "A shipment needs at least one material line").max(500),
});
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export const updateShipmentSchema = z
  .object({
    status: optional(z.enum(ShipmentStatus)),
    shippedDate: dateText,
    deliveredDate: dateText,
    trackingNumber: z.preprocess((v) => (v === null ? "" : v), text(200).optional()),
    licenceNumber: z.preprocess((v) => (v === null ? "" : v), text(100).optional()),
    comment: z.preprocess((v) => (v === null ? "" : v), text(2000).optional()),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;

export const voidShipmentSchema = z.object({
  reason: text(2000).min(3, "A reason for voiding is required"),
});
