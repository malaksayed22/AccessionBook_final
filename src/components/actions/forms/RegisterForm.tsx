"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import {
  buildRegisterPayload,
  initialRegisterValues,
  previewNames,
  REGISTER_SOURCE_TYPES,
  STAGE_CHOICES,
  UNIT_TYPE_CHOICES,
  validateRegisterMaterial,
  type Issues,
  type RegisterKey,
} from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { SelectField, TextAreaField, TextField } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";
import { choicesFrom, useBootstrapOptions } from "../use-options";

type RegisterResponse = {
  units?: Array<{ unitId: number; name: string }>;
  id?: number;
  name?: string;
};

type UnitTypeChoice = (typeof UNIT_TYPE_CHOICES)[number];

/** The form holds the type as a plain string; it can only be one of the choices the select offers. */
const typeOf = (value: string) => value as UnitTypeChoice;

const MATERIAL_KEYS: readonly RegisterKey[] = [
  "experimentId",
  "name",
  "quantity",
  "type",
  "cultivarId",
  "locationId",
  "seedCount",
  "humidWeight",
  "dryWeight",
];

/**
 * Register new units, or receive material from another organisation. Two steps: what the material
 * is and where it goes, then where it came from; the second step ends with a read-back before sending.
 */
export function RegisterForm({
  action,
  context,
  bootstrap,
  onBack,
  onComplete,
  onBusyChange,
}: ActionFormProps) {
  const mode = action === "receive_units" ? "receive" : "register";
  const t = useTranslations("actions");
  const domain = useTranslations("domain");
  const format = useFormatter();
  const options = useBootstrapOptions(bootstrap);
  const [values, set] = useFormValues(() => initialRegisterValues(context.experimentId));
  const [step, setStep] = useState<1 | 2>(1);
  const [issues, setIssues] = useState<Issues<RegisterKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  const weighed = values.type === "PLANT" || values.type === "FLOWER";
  const quantity = Number(values.quantity) || 1;
  const names = previewNames(values.name, quantity);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step === 1) {
      const found = validateRegisterMaterial(values);
      setIssues(found);
      if (Object.keys(found).length === 0) setStep(2);
      return;
    }

    const built = buildRegisterPayload(values, mode);
    if (!built.ok) {
      setIssues(built.issues);
      if (MATERIAL_KEYS.some((key) => built.issues[key])) setStep(1);
      return;
    }
    setIssues({});
    const data = await run(() => sendJson<RegisterResponse>("/api/units", built.payload));
    if (!data) return;
    const count = data.units?.length ?? 1;
    onComplete({
      values: { count, name: data.name ?? values.name.trim() },
      href: data.id ? `/inventory/units/${data.id}` : undefined,
    });
  };

  const noPickers = options.cultivars.length === 0 || options.locations.length === 0;

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      progress={t("launcher.stepLine", {
        current: step,
        total: 2,
        title: t(`register.step${step}`),
      })}
      footer={
        <>
          {step === 2 ? (
            <Button variant="secondary" onClick={() => setStep(1)} disabled={pending}>
              {t("launcher.previousStep")}
            </Button>
          ) : null}
          <SubmitButton
            pending={pending}
            label={step === 1 ? t("launcher.continue") : t(`register.submit.${mode}`)}
          />
        </>
      }
    >
      {step === 1 ? (
        <>
          {noPickers ? <Banner tone="warning">{t("register.missingLists")}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t("fields.experiment")}
              required
              value={values.experimentId}
              onChange={(event) => set("experimentId", event.target.value)}
              options={options.experiments}
              placeholder={t("fields.choose")}
              issue={issues.experimentId}
              className="sm:col-span-2"
            />
            <SelectField
              label={t("fields.type")}
              required
              value={values.type}
              onChange={(event) => set("type", event.target.value)}
              options={choicesFrom(UNIT_TYPE_CHOICES, (key) => domain(`unitType.${key}`))}
              issue={issues.type}
            />
            <SelectField
              label={t("fields.cultivar")}
              required
              value={values.cultivarId}
              onChange={(event) => set("cultivarId", event.target.value)}
              options={options.cultivars}
              placeholder={t("fields.choose")}
              issue={issues.cultivarId}
            />
            <TextField
              label={t("fields.unitName")}
              hint={t("register.nameHint")}
              required
              value={values.name}
              onChange={(event) => set("name", event.target.value)}
              issue={issues.name}
              autoComplete="off"
              maxLength={120}
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
              label={t("fields.location")}
              required
              value={values.locationId}
              onChange={(event) => set("locationId", event.target.value)}
              options={options.locations}
              placeholder={t("fields.choose")}
              issue={issues.locationId}
              className="sm:col-span-2"
            />
            {weighed ? (
              <SelectField
                label={t("fields.initialStage")}
                value={values.growthStage}
                onChange={(event) => set("growthStage", event.target.value)}
                options={choicesFrom(STAGE_CHOICES, (key) => domain(`growthStage.${key}`))}
                className="sm:col-span-2"
              />
            ) : null}
            {values.type === "PLANT" ? (
              <TextField
                label={t("fields.plantCount")}
                hint={t("fields.plantCountHint")}
                type="number"
                inputMode="numeric"
                min={1}
                value={values.plantCount ?? ""}
                onChange={(event) => set("plantCount", event.target.value)}
              />
            ) : null}
            {values.type === "SEEDLOT" ? (
              <TextField
                label={t("fields.seedCount")}
                type="number"
                inputMode="numeric"
                min={0}
                value={values.seedCount}
                onChange={(event) => set("seedCount", event.target.value)}
                issue={issues.seedCount}
              />
            ) : null}
            {weighed ? (
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
            ) : null}
          </div>
        </>
      ) : (
        <>
          {mode === "register" ? (
            <>
              <SelectField
                label={t("fields.sourceType")}
                required
                value={values.sourceType}
                onChange={(event) => set("sourceType", event.target.value)}
                options={choicesFrom(REGISTER_SOURCE_TYPES, (key) => domain(`sourceType.${key}`))}
                issue={issues.sourceType}
              />
              <TextAreaField
                label={t("fields.sourceDescription")}
                hint={t("register.sourceHint")}
                required
                value={values.sourceDescription}
                onChange={(event) => set("sourceDescription", event.target.value)}
                issue={issues.sourceDescription}
              />
            </>
          ) : (
            <>
              <SelectField
                label={t("fields.provider")}
                hint={t("register.providerHint")}
                required
                value={values.providerOrganizationId}
                onChange={(event) => set("providerOrganizationId", event.target.value)}
                options={options.organizations}
                placeholder={t("fields.choose")}
                issue={issues.providerOrganizationId}
              />
              <TextAreaField
                label={t("fields.receiptReference")}
                hint={t("register.receiptHint")}
                value={values.sourceDescription}
                onChange={(event) => set("sourceDescription", event.target.value)}
              />
            </>
          )}
          <TextAreaField
            label={t("fields.notes")}
            value={values.comment}
            onChange={(event) => set("comment", event.target.value)}
          />

          <section
            aria-labelledby="register-review"
            className="rounded-lg border border-border bg-transparent p-4"
          >
            <h4 id="register-review" className="text-sm font-semibold">
              {t("register.review")}
            </h4>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-fg-secondary">{t("fields.type")}</dt>
              <dd>{domain(`unitType.${typeOf(values.type)}`)}</dd>
              <dt className="text-fg-secondary">{t("register.reviewNames")}</dt>
              <dd className="wrap-break-word">{names.join(" … ")}</dd>
              <dt className="text-fg-secondary">{t("fields.quantity")}</dt>
              <dd>{format.number(quantity, "count")}</dd>
            </dl>
          </section>
        </>
      )}
    </FormFrame>
  );
}
