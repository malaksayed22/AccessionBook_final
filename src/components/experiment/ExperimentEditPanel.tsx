"use client";

import { Pencil } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { ExperimentStatusBadge } from "@/components/experiment/ExperimentStatusBadge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/FormControls";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { CALENDAR_DAY_FORMAT, type ExperimentStatus } from "@/features/experiment/dates";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";
import {
  EXPERIMENT_NAME_MAX,
  EXPERIMENT_NOTES_MAX,
  validateEdit,
  type EditDraft,
  type EditField,
} from "./edit-validation";

type Props = {
  experimentId: number;
  /** Admin or member: whether to offer the edit action. The server decides again on save. */
  canEdit: boolean;
  /** Administrators also correct the start day and the completion day. */
  isAdmin: boolean;
  /** `YYYY-MM-DD`: today in the laboratory's time zone, the latest completion date. */
  today: string;
  initial: {
    name: string;
    comment: string | null;
    /** `YYYY-MM-DD` */
    startDate: string;
    /** `YYYY-MM-DD` once the experiment is completed, otherwise null. */
    endDate: string | null;
    /** `YYYY-MM-DD` or null when nobody estimated it. */
    estimatedEndDate: string | null;
    status: ExperimentStatus;
  };
};

export function ExperimentEditPanel({ experimentId, canEdit, isAdmin, today, initial }: Props) {
  const t = useTranslations("experiments.edit");
  const format = useFormatter();
  const router = useRouter();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const { toast } = useToast();

  const fresh = (): EditDraft => ({
    name: initial.name,
    comment: initial.comment ?? "",
    estimatedEndDate: initial.estimatedEndDate ?? "",
    startDate: initial.startDate,
    endDate: initial.endDate ?? "",
  });

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(fresh);

  const issues = validateEdit(draft, { isAdmin, today });
  const error = (field: EditField) => {
    const code = issues[field];
    if (!showErrors || !code) return undefined;
    return t(`errors.${code}`, {
      max: field === "name" ? EXPERIMENT_NAME_MAX : EXPERIMENT_NOTES_MAX,
    });
  };

  const startEditing = () => {
    setDraft(fresh());
    setShowErrors(false);
    setFailure(null);
    setEditing(true);
  };

  const day = (value: string) => format.dateTime(new Date(value), CALENDAR_DAY_FORMAT);

  async function save(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (Object.keys(issues).length > 0) return;
    setSaving(true);
    setFailure(null);
    const result = await sendJson<{ unchanged?: boolean }>(
      `/api/experiments/${experimentId}`,
      {
        name: draft.name.trim(),
        comment: draft.comment.trim(),
        // An empty estimate clears it.
        estimatedEndDate: draft.estimatedEndDate,
        ...(isAdmin
          ? {
              startDate: draft.startDate,
              endDate: initial.endDate ? draft.endDate || undefined : undefined,
            }
          : {}),
      },
      "PATCH"
    );
    setSaving(false);
    if (!result.ok) {
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({
      tone: result.data.unchanged ? "info" : "success",
      title: result.data.unchanged ? t("unchanged") : t("saved"),
    });
    setEditing(false);
    router.refresh();
  }

  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={canEdit ? t("editableHint") : t("readOnlyHint")}
        actions={
          canEdit && !editing ? (
            <Button variant="secondary" icon={<Pencil />} onClick={startEditing}>
              {t("edit")}
            </Button>
          ) : undefined
        }
      />
      <PanelBody>
        {editing ? (
          <form onSubmit={save} noValidate className="flex max-w-2xl flex-col gap-4">
            {failure ? <Banner tone="danger">{failure}</Banner> : null}
            <Field label={t("name")} required error={error("name")}>
              {(control) => (
                <Input
                  value={draft.name}
                  maxLength={EXPERIMENT_NAME_MAX}
                  autoComplete="off"
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  {...control}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("startDate")}
                hint={isAdmin ? undefined : t("startDateLocked")}
                required={isAdmin}
                error={error("startDate")}
              >
                {(control) => (
                  <Input
                    type="date"
                    value={draft.startDate}
                    disabled={!isAdmin}
                    onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
                    {...control}
                  />
                )}
              </Field>
              {initial.endDate ? (
                <Field
                  label={t("completedOn")}
                  hint={isAdmin ? t("completedOnHint") : t("completedOnLocked")}
                  error={error("endDate")}
                >
                  {(control) => (
                    <Input
                      type="date"
                      value={draft.endDate}
                      min={draft.startDate || undefined}
                      max={today}
                      disabled={!isAdmin}
                      onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
                      {...control}
                    />
                  )}
                </Field>
              ) : (
                <Field
                  label={t("estimatedEnd")}
                  hint={t("estimatedEndHint")}
                  error={error("estimatedEndDate")}
                >
                  {(control) => (
                    <Input
                      type="date"
                      value={draft.estimatedEndDate}
                      min={draft.startDate || undefined}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, estimatedEndDate: e.target.value }))
                      }
                      {...control}
                    />
                  )}
                </Field>
              )}
            </div>
            <Field label={t("notes")} hint={t("notesHint")} error={error("comment")}>
              {(control) => (
                <Textarea
                  rows={5}
                  value={draft.comment}
                  onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
                  {...control}
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button type="submit" variant="primary" loading={saving}>
                {t("save")}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-x-8 gap-y-6 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("status")}
              </dt>
              <dd className="mt-2">
                <ExperimentStatusBadge status={initial.status} />
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("started")}
              </dt>
              <dd className="mt-2 text-fg">{day(initial.startDate)}</dd>
            </div>
            {initial.endDate ? (
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("completedOn")}
                </dt>
                <dd className="mt-2 text-fg">{day(initial.endDate)}</dd>
              </div>
            ) : (
              <div>
                <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                  {t("estimatedEnd")}
                </dt>
                <dd className="mt-2 text-fg">
                  {initial.estimatedEndDate ? day(initial.estimatedEndDate) : t("noEstimate")}
                </dd>
              </div>
            )}
            <div className="border-t border-border pt-6 sm:col-span-3">
              <dt className="font-mono text-xs tracking-[0.1em] text-accent-text/80 uppercase">
                {t("notes")}
              </dt>
              <dd className="mt-2 text-fg wrap-break-word whitespace-pre-wrap">
                {initial.comment?.trim() ? initial.comment : t("noNotes")}
              </dd>
            </div>
          </dl>
        )}
      </PanelBody>
    </Panel>
  );
}
