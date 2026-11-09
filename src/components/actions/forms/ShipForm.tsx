"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Checkbox } from "@/components/ui/FormControls";
import {
  buildShipPayload,
  initialShipValues,
  shippingMaterial,
  type Issues,
  type ShipKey,
} from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { SelectField, TextAreaField, TextField } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";
import { useBootstrapOptions } from "../use-options";

/**
 * Create an outbound shipment for one unit. Admin-only. By default it is saved as a draft; ticking
 * "mark as in transit" records the unit as shipped (it leaves inventory) in the same step.
 */
export function ShipForm({
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
  const [values, set] = useFormValues(() =>
    initialShipValues(
      unit ?? { type: "PLANT", seedCount: null, humidWeight: null, dryWeight: null }
    )
  );
  const [issues, setIssues] = useState<Issues<ShipKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;
  const material = shippingMaterial(unit.type);
  const weighed = material === "FLOWER";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildShipPayload(values, unit);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setIssues({});
    const data = await run(() =>
      sendJson<{ shipment: { id: number; reference: string } }>("/api/shipments", built.payload)
    );
    if (!data) return;
    onComplete({
      values: {
        name: unit.name,
        reference: data.shipment.reference,
        sent: values.dispatchNow ? "yes" : "no",
      },
      href: `/inventory/materials/${data.shipment.id}`,
    });
  };

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      footer={
        <SubmitButton
          pending={pending}
          variant={values.dispatchNow ? "danger" : "primary"}
          label={values.dispatchNow ? t("ship.submitNow") : t("ship.submitDraft")}
        />
      }
    >
      <p className="text-sm text-fg-secondary">
        {t("ship.line", { name: unit.name, material: domain(`materialClass.${material}`) })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("ship.recipient")}
          hint={t("ship.recipientHint")}
          required
          value={values.organizationId}
          onChange={(event) => set("organizationId", event.target.value)}
          options={options.organizations}
          placeholder={t("fields.choose")}
          issue={issues.organizationId}
          className="sm:col-span-2"
        />
        <TextField
          label={
            weighed
              ? t("ship.weight")
              : material === "SEED"
                ? t("fields.seedCount")
                : t("fields.quantity")
          }
          required
          type="number"
          inputMode={weighed ? "decimal" : "numeric"}
          step={weighed ? "any" : 1}
          min={0}
          value={values.quantity}
          onChange={(event) => set("quantity", event.target.value)}
          issue={issues.quantity}
        />
        {weighed ? (
          <SelectField
            label={t("ship.basis")}
            required
            value={values.moisture}
            onChange={(event) => set("moisture", event.target.value)}
            options={[
              { value: "WET", label: domain("moisture.WET") },
              { value: "DRY", label: domain("moisture.DRY") },
            ]}
            placeholder={t("fields.choose")}
            issue={issues.moisture}
          />
        ) : null}
        <TextField
          label={t("ship.tracking")}
          value={values.trackingNumber}
          onChange={(event) => set("trackingNumber", event.target.value)}
          autoComplete="off"
        />
        <TextField
          label={t("ship.licence")}
          hint={t("ship.licenceHint")}
          value={values.licenceNumber}
          onChange={(event) => set("licenceNumber", event.target.value)}
          autoComplete="off"
          className="sm:col-span-2"
        />
      </div>
      <TextAreaField
        label={t("fields.notes")}
        value={values.comment}
        onChange={(event) => set("comment", event.target.value)}
        rows={2}
      />
      <Checkbox
        label={t("ship.dispatchNow")}
        description={t("ship.dispatchNowHint")}
        checked={values.dispatchNow}
        onChange={(event) => set("dispatchNow", event.target.checked)}
      />
      {values.dispatchNow ? (
        <Banner tone="warning">{t("ship.dispatchWarning", { name: unit.name })}</Banner>
      ) : null}
    </FormFrame>
  );
}
