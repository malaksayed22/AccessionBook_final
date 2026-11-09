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

type Created = { id: number; name: string; capacity: number | null };

/**
 * Adds a storage location without leaving the wizard (administrators only; the API enforces it). If a
 * location with that name already exists the API answers with its id and we select it instead.
 */
export function NewLocationForm({
  onCreated,
  onCancel,
}: {
  onCreated: (location: Created) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("experiments.wizard.newLocation");
  const apiError = useApiError();
  const networkError = useNetworkError();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [nameIssue, setNameIssue] = useState(false);
  const [capacityIssue, setCapacityIssue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    const limit = capacity.trim() === "" ? null : Number(capacity);
    const badName = trimmed.length < 2;
    const badCapacity = limit !== null && (!Number.isInteger(limit) || limit < 1);
    setNameIssue(badName);
    setCapacityIssue(badCapacity);
    if (badName || badCapacity) return;
    setSaving(true);
    setFailure(null);
    const result = await sendJson<{ location: { id: number; name: string } }>("/api/locations", {
      name: trimmed,
      capacity: limit,
    });
    setSaving(false);
    if (!result.ok) {
      const existing = (result.error as { id?: unknown } | null)?.id;
      if (result.error?.code === "CONFLICT" && typeof existing === "number") {
        toast({ tone: "info", title: t("alreadyThere", { name: trimmed }) });
        onCreated({ id: existing, name: trimmed, capacity: limit });
        return;
      }
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({ tone: "success", title: t("saved", { name: result.data.location.name }) });
    onCreated({ ...result.data.location, capacity: limit });
  }

  return (
    <Panel>
      <PanelBody
        className="flex flex-col gap-4"
        onKeyDown={(event) => {
          // Enter here saves the location; it must not submit the wizard that contains this panel.
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
          <Field
            label={t("capacity")}
            hint={t("capacityHint")}
            error={capacityIssue ? t("capacityInvalid") : undefined}
          >
            {(control) => (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
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
