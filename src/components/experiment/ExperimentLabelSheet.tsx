"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import Barcode from "react-barcode";
import QRCode from "react-qr-code";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { getUnitBarcodeValue, getUnitProfileUrl } from "@/lib/unit-codes";

export type LabelUnit = {
  unitId: number;
  name: string;
  type: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE";
  cultivarName: string | null;
};

/*
 * Barcode labels for an experiment's units, with a print button. Printing hides the application
 * frame through the `printing-intake-labels` print rules in globals.css. The labels themselves are
 * black on white paper in both themes: a barcode scanner needs that contrast, so they do not use the
 * theme tokens.
 */
export function ExperimentLabelSheet({
  experimentCode,
  units,
  omitted,
  baseUrl,
}: {
  experimentCode: string;
  units: LabelUnit[];
  omitted: number;
  baseUrl: string;
}) {
  const t = useTranslations("experiments.labels");
  const unitType = useTranslations("domain.unitType");

  function print() {
    document.body.classList.add("printing-intake-labels");
    window.print();
    document.body.classList.remove("printing-intake-labels");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-secondary">{t("count", { count: units.length })}</p>
        <Button variant="primary" icon={<Printer />} onClick={print} disabled={units.length === 0}>
          {t("print")}
        </Button>
      </div>

      {omitted > 0 ? <Banner tone="warning">{t("omitted", { count: omitted })}</Banner> : null}

      <ul
        aria-label={t("listLabel")}
        className="intake-label-print-area grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
      >
        {units.map((unit) => (
          <li
            key={unit.unitId}
            className="intake-label-card flex flex-col items-center rounded-lg border border-border bg-white p-4 text-black"
          >
            <QRCode value={getUnitProfileUrl(baseUrl, unit.unitId)} size={96} level="M" />
            <Barcode
              value={getUnitBarcodeValue(unit.unitId, unit.name)}
              format="CODE128"
              width={1.2}
              height={36}
              displayValue={false}
              margin={4}
              className="mt-2"
            />
            <p className="mt-2 font-mono text-sm font-bold">{unit.name}</p>
            <p className="text-center text-xs">
              {experimentCode} · {unitType(unit.type)}
              {unit.cultivarName ? ` · ${unit.cultivarName}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
