"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { LocationFormDialog } from "./LocationFormDialog";

/** The "New location" button and its dialog. Rendered for administrators only; the API enforces it too. */
export function NewLocationButton() {
  const t = useTranslations("locations.list");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>
        {t("newLocation")}
      </Button>
      <LocationFormDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
