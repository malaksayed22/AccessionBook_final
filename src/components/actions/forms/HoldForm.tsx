"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  buildPlaceHoldPayload,
  buildReleaseHoldPayload,
  MIN_REASON_LENGTH,
  type HoldKey,
  type Issues,
} from "@/features/action/forms";
import { sendJson } from "@/lib/client-api";
import { TextAreaField } from "../fields";
import { FormFrame, SubmitButton } from "../FormFrame";
import type { ActionFormProps } from "../types";
import { useActionSubmit } from "../use-action-submit";
import { useFormValues } from "../use-form-values";

/** Freeze a unit: it cannot be moved, derived from, restaged, shipped or destroyed until released. */
export function PlaceHoldForm({ action, unit, onBack, onComplete, onBusyChange }: ActionFormProps) {
  const t = useTranslations("actions");
  const domain = useTranslations("domain");
  const [values, set] = useFormValues(() => ({ reason: "" }));
  const [issues, setIssues] = useState<Issues<HoldKey>>({});
  const { pending, error, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildPlaceHoldPayload(values);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    setIssues({});
    const data = await run(() => sendJson(`/api/units/${unit.id}/hold`, built.payload));
    if (!data) return;
    onComplete({
      values: {
        name: unit.name,
        kind: domain("holdKind.HOLD"),
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
      footer={<SubmitButton pending={pending} label={t("hold.submit")} />}
    >
      <Banner tone="warning">{t("hold.effect", { name: unit.name })}</Banner>
      <TextAreaField
        label={t("hold.reason")}
        hint={t("hold.reasonHint", { count: MIN_REASON_LENGTH })}
        required
        value={values.reason}
        onChange={(event) => set("reason", event.target.value)}
        issue={issues.reason}
      />
    </FormFrame>
  );
}

/** Lift a hold. Admin-only and irreversible as a record, so it asks for a reason and the unit's name. */
export function ReleaseHoldForm({
  action,
  unit,
  onBack,
  onComplete,
  onBusyChange,
}: ActionFormProps) {
  const t = useTranslations("actions");
  const domain = useTranslations("domain");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { pending, error, setError, run } = useActionSubmit(onBusyChange);

  if (!unit) return null;

  const release = async ({ reason }: { reason: string }) => {
    const data = await run(() =>
      sendJson(`/api/units/${unit.id}/hold`, buildReleaseHoldPayload(reason))
    );
    if (!data) return;
    setConfirmOpen(false);
    onComplete({ values: { name: unit.name }, href: `/inventory/units/${unit.id}` });
  };

  return (
    <>
      <FormFrame
        action={action}
        onBack={onBack}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setConfirmOpen(true);
        }}
        error={confirmOpen ? null : error}
        footer={<SubmitButton pending={false} label={t("release.open")} />}
      >
        <p className="text-sm">
          {t("release.current", {
            name: unit.name,
            kind: domain("holdKind.HOLD"),
          })}
        </p>
        <Banner tone="info">{t("release.effect")}</Banner>
      </FormFrame>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!pending) setConfirmOpen(open);
        }}
        title={t("release.confirmTitle", { name: unit.name })}
        description={t("release.confirmBody")}
        confirmLabel={t("release.confirm")}
        tone="primary"
        requireReason
        reasonLabel={t("release.reason")}
        reasonMinLength={MIN_REASON_LENGTH}
        typeToConfirm={unit.name}
        pending={pending}
        error={confirmOpen ? error : null}
        onConfirm={(result) => {
          void release(result);
        }}
      />
    </>
  );
}
