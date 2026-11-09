import { useFormatter, useTranslations } from "next-intl";
import type { MaterialTotals } from "@/lib/materials";

/*
 * Quantities of material in words, in the viewer's language. Counted material (seeds, clones,
 * plants, cultures) is whole units; flower and trim are grams with a wet or dry basis. Sync
 * components, so pages (server) and forms (client) share them.
 */

const BUCKETS = ["seeds", "clones", "plants", "cultures"] as const;

/** One line such as "120 seeds · 35 g dry", or the "nothing recorded" text. */
export function MaterialTotalsText({ totals }: { totals: MaterialTotals }) {
  const t = useTranslations("materials.totals");
  const format = useFormatter();
  const parts: string[] = [];
  for (const bucket of BUCKETS) {
    if (totals[bucket]) parts.push(t(bucket, { count: totals[bucket] }));
  }
  if (totals.wetGrams) parts.push(t("wet", { grams: format.number(totals.wetGrams, "grams") }));
  if (totals.dryGrams) parts.push(t("dry", { grams: format.number(totals.dryGrams, "grams") }));
  return <>{parts.length ? parts.join(" · ") : t("none")}</>;
}

type MaterialType = "SEED" | "CLONE" | "PLANT" | "CULTURE" | "FLOWER" | "TRIM";

/** One shipment line's quantity: "12 seeds", or "35.5 g (dry)". */
export function LineQuantity({
  materialType,
  unitCount,
  weightGrams,
  moisture,
}: {
  materialType: MaterialType;
  unitCount: number | null;
  weightGrams: number | null;
  moisture: "WET" | "DRY" | null;
}) {
  const t = useTranslations("materials.quantity");
  const basis = useTranslations("domain.moisture");
  const empty = useTranslations("domain");
  const format = useFormatter();

  if (materialType === "FLOWER" || materialType === "TRIM") {
    if (weightGrams === null) return <>{empty("empty")}</>;
    return (
      <>
        {format.number(weightGrams, "grams")}
        {moisture ? ` (${basis(moisture)})` : ""}
      </>
    );
  }
  if (unitCount === null) return <>{empty("empty")}</>;
  return <>{t(materialType, { count: unitCount })}</>;
}
