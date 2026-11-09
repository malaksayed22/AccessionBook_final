import { z } from "zod";
import { LicenceClass } from "@/generated/prisma/enums";

const text = (max: number) =>
  z.preprocess((v) => (v === null ? "" : v), z.string().trim().max(max));
const name = text(200).pipe(z.string().min(2, "Organization name is required"));
/** "" from the form's "Not set" option clears it. */
const licenceClass = z.preprocess((v) => (v === "" ? null : v), z.enum(LicenceClass).nullable());

/** The organization's address: required, since shipping documents and licences name it. */
const address = text(1000).pipe(z.string().min(1, "An address is required"));

export const createOrganizationSchema = z.object({
  name,
  address,
  country: text(100).optional(),
  licenceNumber: text(100).optional(),
  licenceClass: licenceClass.optional(),
  comment: text(2000).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: name.optional(),
  address: address.optional(),
  country: text(100).optional(),
  licenceNumber: text(100).optional(),
  licenceClass: licenceClass.optional(),
  comment: text(2000).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
