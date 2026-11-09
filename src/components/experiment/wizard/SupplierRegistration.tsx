"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

type Registered = { id: number; name: string };

/**
 * Registers a supplier organization without leaving the wizard (administrators only; the API enforces
 * it). If an organization with that name already exists the API answers with its id and we select it.
 */
export function SupplierRegistration({
  onRegistered,
  onCancel,
}: {
  onRegistered: (organization: Registered) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("experiments.wizard.supplier");
  const apiError = useApiError();
  const networkError = useNetworkError();
  const { toast } = useToast();

  const [draft, setDraft] = useState({ name: "", country: "", licenceNumber: "", address: "" });
  const [nameIssue, setNameIssue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const field = (key: keyof typeof draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) =>
      setDraft((current) => ({ ...current, [key]: e.target.value })),
  });

  async function save() {
    const name = draft.name.trim();
    if (name.length < 2) {
      setNameIssue(true);
      return;
    }
    setNameIssue(false);
    setSaving(true);
    setFailure(null);
    const result = await sendJson<{ organization: Registered }>("/api/organizations", {
      ...draft,
      name,
    });
    setSaving(false);
    if (!result.ok) {
      const existing = (result.error as { id?: unknown } | null)?.id;
      if (result.error?.code === "CONFLICT" && typeof existing === "number") {
        toast({ tone: "info", title: t("alreadyRegistered", { name }) });
        onRegistered({ id: existing, name });
        return;
      }
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({ tone: "success", title: t("saved", { name: result.data.organization.name }) });
    onRegistered(result.data.organization);
  }

  return (
    <Panel>
      <PanelBody
        className="flex flex-col gap-4"
        onKeyDown={(event) => {
          // Enter here saves the supplier; it must not submit the wizard that contains this panel.
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold text-fg">{t("title")}</h3>
          <p className="text-sm text-fg-secondary">{t("description")}</p>
        </div>
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <Field label={t("name")} required error={nameIssue ? t("nameRequired") : undefined}>
          {(control) => <Input autoComplete="off" {...field("name")} {...control} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("country")}>
            {(control) => <Input autoComplete="off" {...field("country")} {...control} />}
          </Field>
          <Field label={t("licenceNumber")}>
            {(control) => <Input autoComplete="off" {...field("licenceNumber")} {...control} />}
          </Field>
        </div>
        <Field label={t("address")}>
          {(control) => <Input autoComplete="off" {...field("address")} {...control} />}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={saving} onClick={save}>
            {t("save")}
          </Button>
          <Button variant="secondary" disabled={saving} onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}
