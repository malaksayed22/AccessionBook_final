"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { UnitPicker } from "@/components/UnitPicker";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";
import { INCIDENT_SEVERITIES } from "@/lib/qa-constants";

type Linked = { id: number; name: string };
type FieldErrors = { title?: string; description?: string };

/*
 * Usage: <QaIncidentForm />                       (the quality console: link a unit by searching)
 *        <QaIncidentForm unitId={12} unitName="P-12" />   (from a unit page: the unit is fixed)
 * Opens a quality incident. A critical incident on a unit in inventory places the unit on hold
 * automatically; the confirmation says so. `onDone` lets a dialog close itself after success.
 */
export function QaIncidentForm({
  unitId,
  unitName,
  onDone,
}: {
  unitId?: number;
  unitName?: string;
  onDone?: () => void;
}) {
  const t = useTranslations("qa.incidentForm");
  const domain = useTranslations("domain.incidentSeverity");
  const router = useRouter();
  const { toast } = useToast();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<string>("MAJOR");
  const [linked, setLinked] = useState<Linked | null>(
    unitId ? { id: unitId, name: unitName ?? String(unitId) } : null
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    const next: FieldErrors = {};
    if (!title.trim()) next.title = t("titleRequired");
    if (!description.trim()) next.description = t("descriptionRequired");
    setErrors(next);
    if (next.title || next.description) return;

    setPending(true);
    const result = await sendJson<{ autoHeld?: boolean }>("/api/qa/incidents", {
      title: title.trim(),
      description: description.trim(),
      severity,
      unitId: linked?.id ?? null,
    });
    setPending(false);
    if (!result.ok) return setFailure(result.network ? networkMessage : describe(result.error));

    toast({
      tone: "success",
      title: t("opened"),
      description: result.data.autoHeld ? t("autoHeld") : undefined,
    });
    setTitle("");
    setDescription("");
    setSeverity("MAJOR");
    setErrors({});
    if (!unitId) setLinked(null);
    router.refresh();
    onDone?.();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {failure ? <Banner tone="danger">{failure}</Banner> : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label={t("title")} error={errors.title} required>
          {(control) => (
            <Input
              {...control}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("severity")} hint={t("severityHint")}>
          {(control) => (
            <Select {...control} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {domain(s.id)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {unitId ? (
        <p className="text-sm text-fg">{t("linkedFixed", { name: linked?.name ?? "" })}</p>
      ) : linked ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-transparent px-4 py-3 text-sm">
          <span>{t("linked", { name: linked.name })}</span>
          <Button size="sm" variant="secondary" onClick={() => setLinked(null)}>
            {t("unlink")}
          </Button>
        </div>
      ) : (
        <UnitPicker<{ id: number; name: string; type: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE" }>
          endpoint="/api/qa/units?scope=any"
          label={t("unit")}
          hint={t("unitHint")}
          onPick={(unit) => setLinked({ id: unit.id, name: unit.name })}
        />
      )}

      <Field
        label={t("description")}
        hint={t("descriptionHint")}
        error={errors.description}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            value={description}
            maxLength={5000}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button type="submit" variant="primary" loading={pending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
