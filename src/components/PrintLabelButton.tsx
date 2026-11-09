"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useImperativeHandle, useRef, type Ref } from "react";
import Barcode from "react-barcode";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/Button";
import { getUnitBarcodeValue } from "@/lib/unit-codes";

/**
 * Prints the unit's label: a QR code that opens its profile and a Code 128 barcode of its name (what
 * the move form asks to be scanned). The label is drawn off screen and is always black on white,
 * whatever the theme; printing hides the rest of the page (see the `printing-unit-label` rules in the
 * global print styles).
 */
export type PrintLabelHandle = { print: () => void };

export function PrintLabelButton({
  unitId,
  unitName,
  unitTypeLabel,
  cultivarName,
  profileUrl,
  mother,
  handle,
}: {
  unitId: number;
  unitName: string;
  /** Already translated, because the label is printed in the reader's language. */
  unitTypeLabel: string;
  cultivarName?: string | null;
  profileUrl: string;
  mother?: { id: number; name: string } | null;
  /** Set when another control prints the label (the unit's Actions menu): no button is drawn. */
  handle?: Ref<PrintLabelHandle>;
}) {
  const t = useTranslations("units.panels.label");
  const printRef = useRef<HTMLDivElement>(null);
  const barcodeValue = getUnitBarcodeValue(unitId, unitName);

  function print() {
    const area = printRef.current;
    if (!area) return;
    area.dataset.printMode = "both";
    document.body.classList.add("printing-unit-label");
    window.print();
    document.body.classList.remove("printing-unit-label");
    delete area.dataset.printMode;
  }
  useImperativeHandle(handle, () => ({ print }));

  return (
    <>
      {handle ? null : (
        <Button variant="secondary" icon={<Printer />} onClick={print}>
          {t("print")}
        </Button>
      )}
      <div ref={printRef} className="unit-label-print-area hidden gap-4 md:grid-cols-2" aria-hidden>
        <figure className="unit-label-qr flex flex-col items-center rounded-lg border border-border bg-white p-5 text-black">
          <QRCode
            value={profileUrl}
            size={144}
            level="M"
            title={t("qrTitle", { name: unitName })}
          />
          <figcaption className="mt-3 flex flex-col items-center text-center">
            <span className="font-mono text-sm font-bold">{unitName}</span>
            <span className="text-xs">
              {unitTypeLabel}
              {cultivarName ? ` · ${cultivarName}` : ""}
            </span>
            {mother ? (
              <span className="unit-label-mother mt-1 text-xs">
                {t("mother")}{" "}
                <span className="font-mono">{getUnitBarcodeValue(mother.id, mother.name)}</span>
              </span>
            ) : null}
            <span className="mt-2 max-w-full text-[10px] break-all">{profileUrl}</span>
          </figcaption>
        </figure>

        <figure className="unit-label-barcode flex flex-col items-center justify-center rounded-lg border border-border bg-white p-5 text-black">
          <Barcode
            value={barcodeValue}
            format="CODE128"
            width={1.5}
            height={64}
            fontSize={14}
            margin={8}
            displayValue
            background="#ffffff"
            lineColor="#000000"
          />
          <figcaption className="mt-2 flex flex-col items-center text-center text-xs">
            <span className="font-medium">{t("barcodeCaption", { id: unitId })}</span>
          </figcaption>
        </figure>
      </div>
    </>
  );
}
