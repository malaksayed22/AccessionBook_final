"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import {
  buildMeasurePayload,
  todayKey,
  type Issues,
  type MeasureKey,
} from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { TextAreaField, TextField, useIssueText } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";

/** Record new weights (plants, flowers) or a new seed count (seed lots). */
export function MeasureForm({ action, unit, onBack, onComplete, onBusyChange }: ActionFormProps) {
  const t = useTranslations("actions");
  const issueText = useIssueText();
  const [today] = useState(() => todayKey());
  const [values, set] = useFormValues(() => ({
    humidWeight: "",
    dryWeight: "",
    seedCount: "",
    date: today,
    comment: "",
  }));
  const [issues, setIssues] = useState<Issues<MeasureKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;
  const weighs = unit.type === "PLANT" || unit.type === "FLOWER";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildMeasurePayload(values, unit.type, today);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setIssues({});
    const data = await run(() => sendJson(`/api/units/${unit.id}/measure`, built.payload));
    if (!data) return;
    onComplete({ values: { name: unit.name }, href: `/inventory/units/${unit.id}` });
  };

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      footer={<SubmitButton pending={pending} label={t("measure.submit")} />}
    >
      {issues.any ? <Banner tone="warning">{issueText(issues.any)}</Banner> : null}
      <p className="text-sm text-fg-secondary">
        {weighs
          ? t("measure.weightIntro", { name: unit.name })
          : t("measure.countIntro", { name: unit.name })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {weighs ? (
          <>
            <TextField
              label={t("fields.wetWeight")}
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              value={values.humidWeight}
              onChange={(event) => set("humidWeight", event.target.value)}
              issue={issues.humidWeight}
            />
            <TextField
              label={t("fields.dryWeight")}
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              value={values.dryWeight}
              onChange={(event) => set("dryWeight", event.target.value)}
              issue={issues.dryWeight}
            />
          </>
        ) : (
          <TextField
            label={t("fields.seedCount")}
            type="number"
            inputMode="numeric"
            min={0}
            value={values.seedCount}
            onChange={(event) => set("seedCount", event.target.value)}
            issue={issues.seedCount}
          />
        )}
        <TextField
          label={t("fields.effectiveDate")}
          hint={t("measure.dateHint")}
          required
          type="date"
          max={today}
          value={values.date}
          onChange={(event) => set("date", event.target.value)}
          issue={issues.date}
        />
      </div>
      <TextAreaField
        label={t("measure.note")}
        value={values.comment}
        onChange={(event) => set("comment", event.target.value)}
        rows={2}
      />
    </FormFrame>
  );
}
