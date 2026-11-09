"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  buildDerivePayload,
  initialDeriveValues,
  STAGE_CHOICES,
  type DeriveKey,
  type Issues,
} from "@/features/action/forms";
import { deriveKindsFor } from "@/lib/action-catalog";
import { sendJson } from "@/lib/client-api";
import { SelectField, TextAreaField, TextField } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";
import { choicesFrom, useBootstrapOptions } from "../use-options";

type DeriveResponse = {
  units?: Array<{ unitId: number; unitName: string }>;
  unitId?: number;
  unitName?: string;
};

/** Take a clone or cutting, or start a subculture, from the unit the launcher is open on. */
export function DeriveForm({
  action,
  bootstrap,
  unit,
  onBack,
  onComplete,
  onBusyChange,
}: ActionFormProps) {
  const t = useTranslations("actions");
  const domain = useTranslations("domain");
  const options = useBootstrapOptions(bootstrap);
  const kinds = unit ? deriveKindsFor(unit.type) : [];
  const [values, set] = useFormValues(() => initialDeriveValues(kinds, unit?.experimentId));
  const [issues, setIssues] = useState<Issues<DeriveKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildDerivePayload(values);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setIssues({});
    const data = await run(() =>
      sendJson<DeriveResponse>(`/api/units/${unit.id}/derive`, built.payload)
    );
    if (!data) return;
    onComplete({
      values: {
        count: data.units?.length ?? 1,
        name: data.unitName ?? "",
        kind: values.deriveType,
        parent: unit.name,
      },
      href: data.unitId ? `/inventory/units/${data.unitId}` : undefined,
    });
  };

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      footer={<SubmitButton pending={pending} label={t("derive.submit")} />}
    >
      <p className="text-sm text-fg-secondary">{t("derive.parent", { name: unit.name })}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("derive.kindLabel")}
          required
          value={values.deriveType}
          onChange={(event) => set("deriveType", event.target.value)}
          options={choicesFrom(kinds, (kind) => t(`derive.kind.${kind}`))}
          issue={issues.deriveType}
        />
        <TextField
          label={t("fields.quantity")}
          hint={t("fields.quantityHint", { max: 50 })}
          required
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          value={values.quantity}
          onChange={(event) => set("quantity", event.target.value)}
          issue={issues.quantity}
        />
        <SelectField
          label={t("derive.experiment")}
          required
          value={values.experimentId}
          onChange={(event) => set("experimentId", event.target.value)}
          options={options.experiments}
          placeholder={t("fields.choose")}
          issue={issues.experimentId}
          className="sm:col-span-2"
        />
        <TextField
          label={t("derive.name")}
          hint={t("derive.nameHint", { name: unit.name })}
          value={values.name}
          onChange={(event) => set("name", event.target.value)}
          issue={issues.name}
          autoComplete="off"
          maxLength={120}
          className="sm:col-span-2"
        />
        <SelectField
          label={t("fields.location")}
          value={values.locationId}
          onChange={(event) => set("locationId", event.target.value)}
          options={options.locations}
          placeholder={t("derive.sameLocation")}
        />
        {values.deriveType !== "subculture" ? (
          <SelectField
            label={t("fields.initialStage")}
            value={values.growthStage}
            onChange={(event) => set("growthStage", event.target.value)}
            options={choicesFrom(STAGE_CHOICES, (key) => domain(`growthStage.${key}`))}
            placeholder={t("derive.defaultStage")}
          />
        ) : null}
      </div>
      <TextAreaField
        label={t("derive.note")}
        value={values.comment}
        onChange={(event) => set("comment", event.target.value)}
      />
    </FormFrame>
  );
}
