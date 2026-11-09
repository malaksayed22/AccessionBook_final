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

type Created = { id: number; name: string };

/**
 * Adds a cultivar to the genetic library without leaving the wizard (administrators only; the API
 * enforces it). If a cultivar with that name already exists the API answers with its id and we use it.
 */
export function NewCultivarForm({
  onCreated,
  onCancel,
}: {
  onCreated: (cultivar: Created) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("experiments.wizard.newCultivar");
  const apiError = useApiError();
  const networkError = useNetworkError();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [nameIssue, setNameIssue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameIssue(true);
      return;
    }
    setNameIssue(false);
    setSaving(true);
    setFailure(null);
    const result = await sendJson<{ cultivar: Created }>("/api/cultivars", {
      name: trimmed,
      code: code.trim() || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      const existing = (result.error as { id?: unknown } | null)?.id;
      if (result.error?.code === "CONFLICT" && typeof existing === "number") {
        toast({ tone: "info", title: t("alreadyThere", { name: trimmed }) });
        onCreated({ id: existing, name: trimmed });
        return;
      }
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({ tone: "success", title: t("saved", { name: result.data.cultivar.name }) });
    onCreated(result.data.cultivar);
  }

  return (
    <Panel>
      <PanelBody
        className="flex flex-col gap-4"
        onKeyDown={(event) => {
          // Enter here saves the cultivar; it must not submit the wizard that contains this panel.
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <div className="flex flex-col gap-0.5">
          <h4 className="text-base font-semibold text-fg">{t("title")}</h4>
          <p className="text-sm text-fg-secondary">{t("description")}</p>
        </div>
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("name")} required error={nameIssue ? t("nameRequired") : undefined}>
            {(control) => (
              <Input
                autoComplete="off"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                {...control}
              />
            )}
          </Field>
          <Field label={t("code")} hint={t("codeHint")}>
            {(control) => (
              <Input
                autoComplete="off"
                maxLength={40}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                {...control}
              />
            )}
          </Field>
        </div>
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
