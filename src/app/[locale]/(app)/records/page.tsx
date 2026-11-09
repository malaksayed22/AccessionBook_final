import { redirect } from "next/navigation";

/** The hub has no page of its own: its first tab is its front door. */
export default function RecordsIndex() {
  redirect("/records/cultivars");
}
