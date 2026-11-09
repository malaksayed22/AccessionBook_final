import { z } from "zod";
import { idSchema } from "@/features/unit/schemas";

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    schema.optional()
  );
}

/** A calendar day in the laboratory's time zone, `YYYY-MM-DD`. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Say what is to be done").max(200),
  details: optional(z.string().trim().max(2000)),
  dueDate: day,
  experimentId: optional(idSchema),
  unitId: optional(idSchema),
  assigneeId: optional(idSchema),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const taskCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("reopen") }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().trim().min(3, "Say why it is cancelled").max(500),
  }),
  z.object({ action: z.literal("reschedule"), dueDate: day }),
  z.object({
    action: z.literal("assign"),
    assigneeId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable()),
  }),
]);
export type TaskCommand = z.infer<typeof taskCommandSchema>;
