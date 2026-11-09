"use client";

import { Plus, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { QaIncidentForm } from "@/components/QaIncidentForm";
import { UnitPicker } from "@/components/UnitPicker";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Select, Textarea } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

/** Fewest characters of reasoning a hold or a resolution needs, so the record explains itself. */
const MIN_REASON = 10;

type PickedUnit = { id: number; name: string; type: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE" };

/** "Open an incident": the incident form in a dialog. */
export function OpenIncidentButton() {
  const t = useTranslations("qa.incidentForm");
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title={t("dialogTitle")}
      description={t("dialogDescription")}
      trigger={
        <Button variant="secondary" icon={<Plus />}>
          {t("open")}
        </Button>
      }
    >
      <QaIncidentForm onDone={() => setOpen(false)} />
    </Dialog>
  );
}

/** "Place a hold": pick a unit and say why. */
export function PlaceHoldButton() {
  const t = useTranslations("qa.placeHold");
  const router = useRouter();
  const { toast } = useToast();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<PickedUnit | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ unit?: string; reason?: string }>({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setUnit(null);
      setReason("");
      setErrors({});
      setFailure("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    const next: typeof errors = {};
    if (!unit) next.unit = t("unitRequired");
    if (reason.trim().length < MIN_REASON) next.reason = t("reasonShort", { count: MIN_REASON });
    setErrors(next);
    if (!unit || next.reason) return;

    setPending(true);
    const result = await sendJson(`/api/units/${unit.id}/hold`, {
      action: "hold",
      kind: "HOLD",
      reason: reason.trim(),
    });
    setPending(false);
    if (!result.ok) return setFailure(result.network ? networkMessage : describe(result.error));

    toast({ tone: "success", title: t("placed", { name: unit.name }) });
    reset(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={reset}
      title={t("title")}
      description={t("description")}
      trigger={
        <Button variant="secondary" icon={<ShieldAlert />}>
          {t("open")}
        </Button>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {failure ? <Banner tone="danger">{failure}</Banner> : null}

        {unit ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-transparent px-4 py-3 text-sm">
            <span>{t("chosen", { name: unit.name })}</span>
            <Button size="sm" variant="secondary" onClick={() => setUnit(null)}>
              {t("change")}
            </Button>
          </div>
        ) : (
          <UnitPicker<PickedUnit>
            endpoint="/api/qa/units?scope=holdable"
            label={t("unit")}
            hint={t("unitHint")}
            error={errors.unit}
            onPick={setUnit}
          />
        )}

        <Field
          label={t("reason")}
          hint={t("reasonHint", { count: MIN_REASON })}
          error={errors.reason}
          required
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => reset(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const STATUSES = ["OPEN", "INVESTIGATING", "CLOSED"] as const;

/** Move an incident along (open, investigating, closed); closing needs a resolution. */
export function UpdateIncidentButton({
  id,
  title,
  status,
  resolution,
}: {
  id: number;
  title: string;
  status: (typeof STATUSES)[number];
  resolution: string | null;
}) {
  const t = useTranslations("qa.updateIncident");
  const statuses = useTranslations("domain.incidentStatus");
  const router = useRouter();
  const { toast } = useToast();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<string>(status);
  const [text, setText] = useState(resolution ?? "");
  const [error, setError] = useState("");
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    if (next === "CLOSED" && text.trim().length < MIN_REASON) {
      return setError(t("resolutionShort", { count: MIN_REASON }));
    }
    setError("");
    setPending(true);
    const result = await sendJson(
      `/api/qa/incidents/${id}`,
      { status: next, resolution: text.trim() || undefined },
      "PATCH"
    );
    setPending(false);
    if (!result.ok) return setFailure(result.network ? networkMessage : describe(result.error));

    toast({ tone: "success", title: t("done") });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setNext(status);
          setText(resolution ?? "");
          setError("");
          setFailure("");
        }
      }}
      title={t("title")}
      description={title}
      trigger={
        <Button size="sm" variant="secondary" aria-label={t("ariaLabel", { title })}>
          {t("open")}
        </Button>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <Field label={t("status")}>
          {(control) => (
            <Select {...control} value={next} onChange={(e) => setNext(e.target.value)}>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statuses(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t("resolution")}
          hint={next === "CLOSED" ? t("resolutionHint", { count: MIN_REASON }) : undefined}
          error={error}
          required={next === "CLOSED"}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={text}
              maxLength={5000}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
