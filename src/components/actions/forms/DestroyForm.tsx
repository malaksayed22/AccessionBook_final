"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  buildDestroyPayload,
  MIN_REASON_LENGTH,
  todayKey,
  validateDestroyDetails,
  type DestroyKey,
  type Issues,
} from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { TextField } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";

/**
 * Record the destruction of a unit (administrators only). Two stages: when, then a confirmation that
 * needs the reason and the unit's name typed in full. The server asks for a recent password
 * confirmation; `sendJson` opens that prompt and repeats the request.
 */
export function DestroyForm({ action, unit, onBack, onComplete, onBusyChange }: ActionFormProps) {
  const t = useTranslations("actions");
  const [today] = useState(() => todayKey());
  const [values, set] = useFormValues(() => ({ date: today }));
  const [issues, setIssues] = useState<Issues<DestroyKey>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { pending, error, setError, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;

  const review = (event: FormEvent) => {
    event.preventDefault();
    const found = validateDestroyDetails(values, today);
    setIssues(found);
    if (Object.keys(found).length > 0) return;
    setError(null);
    setConfirmOpen(true);
  };

  const destroy = async ({ reason }: { reason: string }) => {
    const payload = buildDestroyPayload(values, reason, today);
    const data = await run(() => sendJson(`/api/units/${unit.id}/destroy`, payload));
    if (!data) return;
    setConfirmOpen(false);
    onComplete({ values: { name: unit.name }, href: `/inventory/units/${unit.id}` });
  };

  return (
    <>
      <FormFrame
        action={action}
        onBack={onBack}
        onSubmit={review}
        error={confirmOpen ? null : error}
        footer={<SubmitButton pending={false} variant="danger" label={t("destroy.review")} />}
      >
        <Banner tone="danger" title={t("destroy.warningTitle")}>
          {t("destroy.warning", { name: unit.name })}
        </Banner>
        <TextField
          label={t("destroy.date")}
          hint={t("destroy.dateHint")}
          required
          type="date"
          max={today}
          value={values.date}
          onChange={(event) => set("date", event.target.value)}
          issue={issues.date}
        />
      </FormFrame>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!pending) setConfirmOpen(open);
        }}
        title={t("destroy.confirmTitle", { name: unit.name })}
        description={t("destroy.confirmBody")}
        confirmLabel={t("destroy.confirm")}
        requireReason
        reasonLabel={t("destroy.reason")}
        reasonHint={t("destroy.reasonHint", { count: MIN_REASON_LENGTH })}
        reasonMinLength={MIN_REASON_LENGTH}
        typeToConfirm={unit.name}
        pending={pending}
        error={confirmOpen ? error : null}
        onConfirm={(result) => {
          void destroy(result);
        }}
      />
    </>
  );
}
