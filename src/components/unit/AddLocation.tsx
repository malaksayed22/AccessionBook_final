"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { NewLocationForm } from "@/components/experiment/wizard/NewLocationForm";
import { Button } from "@/components/ui/Button";
import type { Option } from "./action-types";

/**
 * "Add a new location" inside a move form (administrators only; the API enforces it too). Shows a
 * button that opens the same small form the experiment wizard uses; once the location exists it is
 * handed back so the form can select it. The inline form handles Enter itself, so it never submits the
 * move form around it.
 */
export function AddLocation({ onAdded }: { onAdded: (location: Option) => void }) {
  const t = useTranslations("units.actions.move");
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <NewLocationForm
        onCancel={() => setAdding(false)}
        onCreated={(created) => {
          onAdded({ id: created.id, name: created.name });
          setAdding(false);
        }}
      />
    );
  }
  return (
    <Button variant="secondary" icon={<Plus />} className="self-start" onClick={() => setAdding(true)}>
      {t("newLocation")}
    </Button>
  );
}
