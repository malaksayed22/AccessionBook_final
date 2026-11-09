"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

/** Opens the browser's print dialog (which also saves as PDF). Hidden on the printed page. */
export function PrintAuditButton() {
  const t = useTranslations("units.export");
  return (
    <Button
      variant="primary"
      icon={<Printer />}
      className="mb-6 print:hidden"
      onClick={() => window.print()}
    >
      {t("print")}
    </Button>
  );
}
