"use client";

import { FilePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { sendForm } from "@/components/actions/use-action-submit";
import { ACCEPTED_UPLOAD_TYPES } from "@/components/experiment/document-upload";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";

/**
 * "Add document" on an organization's page: its licence, an agreement, supplier or laboratory
 * paperwork. The form opens in a dialog; administrators only (the API enforces it too).
 */
export function OrganizationAddDocumentButton({
  organizationId,
  organizationName,
}: {
  organizationId: number;
  organizationName: string;
}) {
  const t = useTranslations("organizations.documents");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const input = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setLabel("");
    setFailure(null);
  };

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
    const result = await sendForm(`/api/organizations/${organizationId}/documents`, form);
    setSaving(false);
    if (!result.ok) {
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({ tone: "success", title: t("added") });
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" icon={<FilePlus />} onClick={() => setOpen(true)}>
        {t("add")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (saving) return;
          setOpen(next);
          if (!next) reset();
        }}
        title={t("addTitle", { name: organizationName })}
        description={t("addDescription")}
      >
        <form onSubmit={upload} noValidate className="flex flex-col gap-4">
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
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {t("upload")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
