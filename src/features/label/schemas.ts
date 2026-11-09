import { z } from "zod";
import { LABEL_TEMPLATE_IDS } from "@/lib/labels/templates";

const id = z.coerce.number().int().positive();

/** What `GET /api/labels` is asked to print, from its query string. */
export const labelRequestSchema = z
  .discriminatedUnion("for", [
    z.object({ for: z.literal("unit"), id }),
    z.object({ for: z.literal("experiment"), id }),
    z.object({ for: z.literal("shipment"), id }),
    z.object({ for: z.literal("tissue"), id }),
    // Without an id: a label for every active location.
    z.object({ for: z.literal("location"), id: id.optional() }),
  ])
  .and(
    z.object({
      template: z.enum(LABEL_TEMPLATE_IDS),
      /** Labels already used on a part-used sheet. */
      skip: z.coerce.number().int().min(0).max(79).default(0),
      /** Copies of a single label, up to a sheet. */
      copies: z.coerce.number().int().min(1).max(80).default(1),
    })
  );

export type LabelRequest = z.infer<typeof labelRequestSchema>;
