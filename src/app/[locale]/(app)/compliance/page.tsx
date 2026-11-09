import { redirect } from "next/navigation";

/** The compliance hub has no page of its own: it opens on the reports. */
export default function CompliancePage() {
  redirect("/compliance/reports");
}
