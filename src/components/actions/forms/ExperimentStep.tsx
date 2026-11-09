"use client";

import { ArrowLeft, FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import type { ActionFormProps } from "../types";

/**
 * Experiments are created on their own page (`/inventory/experiments/new`, a guided form with a saved draft),
 * not inside this dialog: it carries too many decisions for a popup. This step explains that and
 * links there, passing the parent experiment and the source unit along for a sub-experiment.
 */
export function ExperimentStep({ action, context, unit, onBack, onClose }: ActionFormProps) {
  const t = useTranslations("actions");
  const sub = action === "new_sub_experiment";
  const query = new URLSearchParams();
  const parentId = unit?.experimentId ?? context.experimentId;
  if (sub && parentId) query.set("parent", String(parentId));
  if (sub && unit) query.set("unit", String(unit.id));
  const href =
    query.size > 0
      ? `/inventory/experiments/new?${query.toString()}`
      : "/inventory/experiments/new";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack} className="-ms-2">
          {t("launcher.back")}
        </Button>
      </div>
      <h3 className="text-base font-semibold">{t(`items.${action}.title`)}</h3>
      <p className="text-sm text-fg-secondary">
        {sub && unit ? t("experiment.subBody", { name: unit.name }) : t("experiment.body")}
      </p>
      <div>
        <Button href={href} variant="primary" icon={<FlaskConical />} onClick={onClose}>
          {t("experiment.open")}
        </Button>
      </div>
    </div>
  );
}
