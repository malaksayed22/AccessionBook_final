import { z } from "zod";

const body = z.string().trim().min(20, "Write the procedure (at least a few lines)").max(50_000);

export const createSopSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, "Use letters, digits and dashes, such as SOP-012"),
  title: z.string().trim().min(3, "Give the procedure a title").max(200),
  body,
});
export type CreateSopInput = z.infer<typeof createSopSchema>;

export const sopCommandSchema = z.discriminatedUnion("action", [
  /** A new draft version, from the text of the one before. */
  z.object({
    action: z.literal("draft"),
    body,
    changeNote: z.string().trim().min(3, "Say what changed").max(1000),
  }),
  /** The draft takes effect; the version in effect before it is superseded. */
  z.object({ action: z.literal("approve") }),
  /** The member signs that they have read and understood the version in effect. */
  z.object({ action: z.literal("sign") }),
]);
export type SopCommand = z.infer<typeof sopCommandSchema>;
