"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { buildMovePayload, type Issues, type MoveKey } from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { TextAreaField, SelectField, TextField } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";
import { useBootstrapOptions } from "../use-options";

/** Move a unit to another location. The unit's barcode (its name) must be scanned or typed to confirm. */
export function MoveForm({
  action,
  bootstrap,
  unit,
  onBack,
  onComplete,
  onBusyChange,
}: ActionFormProps) {
  const t = useTranslations("actions");
  const options = useBootstrapOptions(bootstrap);
  const [values, set] = useFormValues(() => ({ toLocationId: "", barcode: "", comment: "" }));
  const [issues, setIssues] = useState<Issues<MoveKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;
  const current = bootstrap.locations.find((location) => location.id === unit.locationId);
  const destinations = options.locations.filter(
    (option) => option.value !== String(unit.locationId)
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildMovePayload(values, unit);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setIssues({});
    const data = await run(() =>
      sendJson<{ location: string }>(`/api/units/${unit.id}/transfer`, built.payload)
    );
    if (!data) return;
    onComplete({
      values: { name: unit.name, location: data.location },
      href: `/inventory/units/${unit.id}`,
    });
  };

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      footer={<SubmitButton pending={pending} label={t("move.submit")} />}
    >
      <p className="text-sm text-fg-secondary">
        {current
          ? t("move.currentLocation", { name: unit.name, location: current.name })
          : t("move.noLocation", { name: unit.name })}
      </p>
      <SelectField
        label={t("move.destination")}
        required
        value={values.toLocationId}
        onChange={(event) => set("toLocationId", event.target.value)}
        options={destinations}
        placeholder={t("fields.choose")}
        issue={issues.toLocationId}
      />
      <TextField
        label={t("move.barcode")}
        hint={t("move.barcodeHint", { name: unit.name })}
        required
        value={values.barcode}
        onChange={(event) => set("barcode", event.target.value)}
        issue={issues.barcode}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <TextAreaField
        label={t("move.note")}
        value={values.comment}
        onChange={(event) => set("comment", event.target.value)}
        rows={2}
      />
    </FormFrame>
  );
}
