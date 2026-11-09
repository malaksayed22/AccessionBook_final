import { z } from "zod";
import { MAX_VIEW_QUERY, VIEW_LISTS } from "@/lib/table-view";

export const saveViewSchema = z.object({
  list: z.enum(VIEW_LISTS),
  name: z.string().trim().min(1, "Name the view").max(60),
  /** The list's query string: filters, sort, hidden columns and grouping. */
  query: z.string().max(MAX_VIEW_QUERY),
});
export type SaveViewInput = z.infer<typeof saveViewSchema>;
