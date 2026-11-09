"use client";

import { Download, Paperclip } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import type { ExperimentDocumentRow } from "@/features/experiment/queries";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendForm } from "@/components/actions/use-action-submit";
import { ACCEPTED_UPLOAD_TYPES, formatFileSize } from "./document-upload";

/**
 * The documents of one experiment: its protocol, approvals, supplier paperwork. Members of the
 * experiment and administrators add them; a document is removed with a reason, never deleted.
 */
export function ExperimentDocumentsPanel({
  experimentId,
  documents,
  canEdit,
}: {
  experimentId: number;
  documents: ExperimentDocumentRow[];
  canEdit: boolean;
}) {
  const t = useTranslations("experiments.documents");
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const input = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setFailure(t("fileRequired"));
      return;
    }
    setSaving(true);
    setFailure(null);
    const form = new FormData();
    form.append("file", file);
    if (label.trim()) form.append("label", label.trim());
    const result = await sendForm(`/api/experiments/${experimentId}/documents`, form);
    setSaving(false);
    if (!result.ok) {
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({ tone: "success", title: t("added") });
    setFile(null);
    setLabel("");
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <Panel>
      <PanelHeader title={t("title")} description={t("description")} />
      <PanelBody className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("none")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((document) => (
              <li key={document.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Paperclip aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-tertiary" />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/experiments/${experimentId}/documents/${document.id}`}
                    className="inline-flex min-h-6 items-center gap-1.5 font-medium text-accent-text hover:underline"
                  >
                    {document.label}
                    <Download aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">{t("download")}</span>
                  </a>
                  <p className="text-sm text-fg-secondary">
                    {document.fileName}
                    {document.sizeBytes ? ` · ${formatFileSize(document.sizeBytes)}` : ""}
                    {" · "}
                    {t("addedBy", {
                      name: document.userName,
                      date: format.dateTime(document.createdAt, "date"),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <form onSubmit={upload} noValidate className="space-y-4 border-t border-border pt-4">
            {failure ? <Banner tone="danger">{failure}</Banner> : null}
            <Field label={t("file")} hint={t("fileHint")} required>
              {(control) => (
                <Input
                  ref={input}
                  type="file"
                  accept={ACCEPTED_UPLOAD_TYPES}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  {...control}
                />
              )}
            </Field>
            <Field label={t("label")} hint={t("labelHint")}>
              {(control) => (
                <Input
                  value={label}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(e) => setLabel(e.target.value)}
                  {...control}
                />
              )}
            </Field>
            <Button type="submit" variant="secondary" loading={saving}>
              {t("upload")}
            </Button>
          </form>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
