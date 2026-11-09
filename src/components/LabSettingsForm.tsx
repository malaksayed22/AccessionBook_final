"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { LICENCE_CLASSES } from "@/lib/organization-profile";
import { useRequestAction } from "./use-request-action";

export type LabSettingsValues = {
  licenceNumber: string | null;
  licenceHolder: string | null;
  licenceClass: string | null;
  siteAddress: string | null;
  backdateLimitDays: number | null;
  experimentCodePrefix: string;
};

/** The laboratory's settings. Saving asks for the password again when the session is not recent. */
export function LabSettingsForm({ settings }: { settings: LabSettingsValues }) {
  const t = useTranslations("settings.form");
  const domain = useTranslations("domain");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [values, setValues] = useState({
    licenceNumber: settings.licenceNumber ?? "",
    licenceHolder: settings.licenceHolder ?? "",
    licenceClass: settings.licenceClass ?? "",
    siteAddress: settings.siteAddress ?? "",
    backdateLimitDays: settings.backdateLimitDays?.toString() ?? "",
    experimentCodePrefix: settings.experimentCodePrefix,
  });
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const prefixOk = /^[A-Za-z]{2,6}$/.test(values.experimentCodePrefix.trim());
  const days = values.backdateLimitDays.trim();
  const daysOk = days === "" || (/^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 3650);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prefixOk || !daysOk) return;
    const result = await action.run(() =>
      sendJson(
        "/api/settings",
        {
          licenceNumber: values.licenceNumber,
          licenceHolder: values.licenceHolder,
          licenceClass: values.licenceClass,
          siteAddress: values.siteAddress,
          backdateLimitDays: days === "" ? null : Number(days),
          experimentCodePrefix: values.experimentCodePrefix.trim().toUpperCase(),
        },
        "PATCH"
      )
    );
    if (!result.ok) return;
    toast({ tone: "success", title: t("saved") });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col divide-y divide-border" noValidate>
      {action.error ? (
        <div className="px-5 pt-5 sm:px-8 sm:pt-6">
          <Banner tone="danger">{action.error}</Banner>
        </div>
      ) : null}
      <fieldset className="grid gap-x-6 gap-y-5 px-5 pb-8 sm:grid-cols-2 sm:px-8">
        <legend className="pt-8 pb-5 text-lg font-semibold tracking-[-0.015em] text-fg">
          {t("licence")}
        </legend>
        <Field label={t("licenceNumber")} hint={t("licenceNumberHint")}>
          {(control) => (
            <Input
              value={values.licenceNumber}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => set("licenceNumber")(e.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("licenceClass")}>
          {(control) => (
            <Select
              value={values.licenceClass}
              onChange={(e) => set("licenceClass")(e.target.value)}
              {...control}
            >
              <option value="">{t("licenceClassNone")}</option>
              {LICENCE_CLASSES.map((id) => (
                <option key={id} value={id}>
                  {domain(`licenceClass.${id}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("licenceHolder")}>
          {(control) => (
            <Input
              value={values.licenceHolder}
              maxLength={200}
              onChange={(e) => set("licenceHolder")(e.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("siteAddress")}>
          {(control) => (
            <Input
              value={values.siteAddress}
              maxLength={500}
              onChange={(e) => set("siteAddress")(e.target.value)}
              {...control}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-x-6 gap-y-5 px-5 pb-8 sm:grid-cols-2 sm:px-8">
        <legend className="pt-8 pb-5 text-lg font-semibold tracking-[-0.015em] text-fg">
          {t("records")}
        </legend>
        <Field
          label={t("backdateLimit")}
          hint={t("backdateLimitHint")}
          error={daysOk ? undefined : t("backdateLimitInvalid")}
        >
          {(control) => (
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              value={values.backdateLimitDays}
              onChange={(e) => set("backdateLimitDays")(e.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field
          label={t("codePrefix")}
          hint={t("codePrefixHint", {
            example: `${values.experimentCodePrefix.trim().toUpperCase() || "EXP"}12`,
          })}
          error={prefixOk ? undefined : t("codePrefixInvalid")}
          required
        >
          {(control) => (
            <Input
              value={values.experimentCodePrefix}
              maxLength={6}
              autoComplete="off"
              onChange={(e) => set("experimentCodePrefix")(e.target.value)}
              {...control}
            />
          )}
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2 bg-sunken/60 px-5 py-4 sm:px-8">
        <Button type="submit" variant="primary" disabled={action.pending || !prefixOk || !daysOk}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
