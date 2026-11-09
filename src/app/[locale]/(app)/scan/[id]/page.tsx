import { redirect } from "next/navigation";
import { getUnitProfilePath } from "@/lib/unit-codes";

export default async function ScanUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(getUnitProfilePath(Number(id)));
}
