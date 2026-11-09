"use client";

import { isLaterStage } from "@/lib/stage-order";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  buildStagePayload,
  STAGE_CHOICES,
  todayKey,
  type Issues,
  type StageKey,
} from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { SelectField, TextAreaField, TextField } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";
import { choicesFrom } from "../use-options";

/** Report that a plant or flower entered a new growth stage, optionally back-dated. */
export function StageForm({ action, unit, onBack, onComplete, onBusyChange }: ActionFormProps) {
  const t = useTranslations("actions");
  const domain = useTranslations("domain");
  const [today] = useState(() => todayKey());
  const [values, set] = useFormValues(() => ({ toStage: "", date: today, comment: "" }));
  const [issues, setIssues] = useState<Issues<StageKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;
  // Stages only move forward, so only the later ones are offered.
  const stages = STAGE_CHOICES.filter((stage) => isLaterStage(unit.growthStage, stage));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildStagePayload(values, unit, today);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setIssues({});
    const data = await run(() =>
      sendJson<{ toStage: string }>(`/api/units/${unit.id}/stage-transition`, built.payload)
    );
    if (!data) return;
    onComplete({
      values: {
        name: unit.name,
        stage: domain(`growthStage.${values.toStage as (typeof STAGE_CHOICES)[number]}`),
      },
      href: `/inventory/units/${unit.id}`,
    });
  };

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      footer={<SubmitButton pending={pending} label={t("stage.submit")} />}
    >
      {unit.growthStage ? (
        <p className="text-sm text-fg-secondary">
          {t("stage.current", {
            name: unit.name,
            stage: domain(`growthStage.${unit.growthStage as (typeof STAGE_CHOICES)[number]}`),
          })}
        </p>
      ) : null}
      <SelectField
        label={t("stage.newStage")}
        required
        value={values.toStage}
        onChange={(event) => set("toStage", event.target.value)}
        options={choicesFrom(stages, (key) => domain(`growthStage.${key}`))}
        placeholder={t("fields.choose")}
        issue={issues.toStage}
      />
      <TextField
        label={t("fields.effectiveDate")}
        hint={t("stage.dateHint")}
        required
        type="date"
        max={today}
        value={values.date}
        onChange={(event) => set("date", event.target.value)}
        issue={issues.date}
      />
      <TextAreaField
        label={t("stage.note")}
        value={values.comment}
        onChange={(event) => set("comment", event.target.value)}
        rows={2}
      />
    </FormFrame>
  );
}
