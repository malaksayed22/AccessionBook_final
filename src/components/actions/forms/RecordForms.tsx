"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  ACTIVITY_TYPE_CHOICES,
  ATTACHMENT_CATEGORY_CHOICES,
  buildActivityPayload,
  validateAttachment,
  type ActivityKey,
  type AttachKey,
  type Issues,
} from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { MAX_UPLOAD_BYTES } from "@/lib/file-types";
import { SelectField, TextAreaField, TextField, useIssueText } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { sendForm, useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";
import { choicesFrom } from "../use-options";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";

/** Log a treatment, observation or environmental reading against the unit. */
export function ActivityForm({ action, unit, onBack, onComplete, onBusyChange }: ActionFormProps) {
  const t = useTranslations("actions");
  const domain = useTranslations("domain");
  const [values, set] = useFormValues(() => ({
    type: "NUTRIENT",
    title: "",
    details: "",
    product: "",
    pcpNumber: "",
    amount: "",
    amountUnit: "",
    method: "",
  }));
  const needsProduct = values.type === "PESTICIDE" || values.type === "BENEFICIAL_INSECTS";
  const [issues, setIssues] = useState<Issues<ActivityKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildActivityPayload(values);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setIssues({});
    const data = await run(() => sendJson(`/api/units/${unit.id}/activities`, built.payload));
    if (!data) return;
    onComplete({
      values: { name: unit.name, title: values.title.trim() },
      href: `/inventory/units/${unit.id}`,
    });
  };

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      footer={<SubmitButton pending={pending} label={t("activity.submit")} />}
    >
      <SelectField
        label={t("activity.type")}
        required
        value={values.type}
        onChange={(event) => set("type", event.target.value)}
        options={choicesFrom(ACTIVITY_TYPE_CHOICES, (key) => domain(`activityType.${key}`))}
        issue={issues.type}
      />
      <TextField
        label={t("activity.title")}
        required
        value={values.title}
        onChange={(event) => set("title", event.target.value)}
        issue={issues.title}
        autoComplete="off"
        maxLength={200}
      />
      <TextField
        label={t("activity.product")}
        hint={t("activity.productHint")}
        required={needsProduct}
        value={values.product}
        onChange={(event) => set("product", event.target.value)}
        issue={issues.product}
        autoComplete="off"
        maxLength={200}
      />
      {values.type === "PESTICIDE" ? (
        <TextField
          label={t("activity.pcpNumber")}
          hint={t("activity.pcpNumberHint")}
          required
          value={values.pcpNumber}
          onChange={(event) => set("pcpNumber", event.target.value)}
          issue={issues.pcpNumber}
          autoComplete="off"
          maxLength={40}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("activity.amount")}
          required={needsProduct}
          inputMode="decimal"
          value={values.amount}
          onChange={(event) => set("amount", event.target.value)}
          issue={issues.amount}
          autoComplete="off"
        />
        <TextField
          label={t("activity.amountUnit")}
          hint={t("activity.amountUnitHint")}
          required={values.amount.trim() !== ""}
          value={values.amountUnit}
          onChange={(event) => set("amountUnit", event.target.value)}
          issue={issues.amountUnit}
          autoComplete="off"
          maxLength={20}
        />
      </div>
      <TextField
        label={t("activity.method")}
        value={values.method}
        onChange={(event) => set("method", event.target.value)}
        autoComplete="off"
        maxLength={200}
      />
      <TextAreaField
        label={t("activity.details")}
        value={values.details}
        onChange={(event) => set("details", event.target.value)}
      />
    </FormFrame>
  );
}

/** Attach a photo, protocol or certificate to the unit. The server checks the file's real type. */
export function AttachForm({ action, unit, onBack, onComplete, onBusyChange }: ActionFormProps) {
  const t = useTranslations("actions");
  const domain = useTranslations("domain");
  const issueText = useIssueText();
  const [values, set] = useFormValues(() => ({ category: "PHOTO", label: "" }));
  const [file, setFile] = useState<File | null>(null);
  const [issues, setIssues] = useState<Issues<AttachKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateAttachment(values, file, MAX_UPLOAD_BYTES);
    setIssues(found);
    if (Object.keys(found).length > 0 || !file) return;

    const body = new FormData();
    body.append("file", file);
    body.append("label", values.label.trim());
    body.append("category", values.category);
    const data = await run(() => sendForm(`/api/units/${unit.id}/attachments`, body));
    if (!data) return;
    onComplete({
      values: { name: unit.name, label: values.label.trim() },
      href: `/inventory/units/${unit.id}`,
    });
  };

  return (
    <FormFrame
      action={action}
      onBack={onBack}
      onSubmit={submit}
      error={error}
      footer={<SubmitButton pending={pending} label={t("attach.submit")} />}
    >
      <SelectField
        label={t("attach.category")}
        required
        value={values.category}
        onChange={(event) => set("category", event.target.value)}
        options={choicesFrom(ATTACHMENT_CATEGORY_CHOICES, (key) =>
          domain(`attachmentCategory.${key}`)
        )}
        issue={issues.category}
      />
      <TextField
        label={t("attach.label")}
        required
        value={values.label}
        onChange={(event) => set("label", event.target.value)}
        issue={issues.label}
        autoComplete="off"
        maxLength={200}
      />
      <Field
        label={t("attach.file")}
        hint={t("attach.fileHint", { megabytes: MAX_UPLOAD_BYTES / (1024 * 1024) })}
        required
        error={
          issues.file?.code === "range"
            ? t("attach.tooLarge", { megabytes: MAX_UPLOAD_BYTES / (1024 * 1024) })
            : issueText(issues.file)
        }
      >
        {(control) => (
          <Input
            {...control}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        )}
      </Field>
    </FormFrame>
  );
}
