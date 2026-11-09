"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Opens the browser's print dialog; the recall page hides its controls when printed. */
export function RecallPrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>
      {label}
    </Button>
  );
}
