"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { sendForm } from "@/components/actions/use-action-submit";
import { FilePicker } from "@/components/FilePicker";
import { MAX_UPLOAD_BYTES } from "@/lib/file-types";
import { formatFileSize } from "@/components/experiment/document-upload";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { Link, useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { LICENCE_CLASSES } from "@/lib/organization-profile";
import { useRequestAction } from "./use-request-action";

type OrganizationFields = {
  name: string;
  address: string;
  country: string;
  licenceNumber: string;
  /** A licence class, or "" for not set. */
  licenceClass: string;
  comment: string;
};

type Props = {
  mode: "create" | "edit";
  organizationId?: number;
  initial?: Partial<OrganizationFields>;
  /** Called instead of navigating to the organization after a successful save. */
  onSuccess?: (organization: { id: number; name: string }) => void;
  onCancel?: () => void;
};

type SavedOrganization = { organization: { id: number; name: string } };

/** Register or edit an organization (supplier, lab, partner). Administrators only; the API enforces it. */
export function OrganizationForm({ mode, organizationId, initial, onSuccess, onCancel }: Props) {
  const t = useTranslations("organizations.form");
  const domain = useTranslations("domain");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();

  const [form, setForm] = useState<OrganizationFields>({
    name: initial?.name ?? "",
    address: initial?.address ?? "",
    country: initial?.country ?? "",
    licenceNumber: initial?.licenceNumber ?? "",
    licenceClass: initial?.licenceClass ?? "",
    comment: initial?.comment ?? "",
  });
  const [nameError, setNameError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  // Chosen here, sent once the organization exists (registering only).
  const [files, setFiles] = useState<File[]>([]);
  const set = (key: keyof OrganizationFields) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  // A name that is already registered comes back as a conflict that names the existing record.
  const duplicateId = (action.errorBody as { id?: unknown } | null)?.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    const badName = name.length < 2 ? t("nameRequired") : null;
    // Every organization needs its address: shipping documents and licences name it.
    const badAddress = form.address.trim() === "" ? t("addressRequired") : null;
    setNameError(badName);
    setAddressError(badAddress);
    if (badName || badAddress) return;

    const body = { ...form, name };
    const result = await action.run(() =>
      mode === "create"
        ? sendJson<SavedOrganization>("/api/organizations", body)
        : sendJson<SavedOrganization>(`/api/organizations/${organizationId}`, body, "PATCH")
    );
    if (!result.ok) return;

    const saved = result.data.organization;
    let uploaded = 0;
    if (mode === "create") {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        const sent = await sendForm(`/api/organizations/${saved.id}/documents`, body);
        if (sent.ok) uploaded += 1;
      }
    }
    const failed = files.length - uploaded;
    toast({
      tone: failed > 0 ? "warning" : "success",
      title:
        mode === "create"
          ? t("createdTitle", { name: saved.name })
          : t("savedTitle", { name: saved.name }),
      description:
        mode === "create" && files.length > 0
          ? [
              uploaded > 0 ? t("createdFiles", { count: uploaded }) : null,
              failed > 0 ? t("filesFailed", { count: failed }) : null,
            ]
              .filter(Boolean)
              .join(" ")
          : undefined,
    });
    if (onSuccess) return onSuccess(saved);
    if (mode === "create") router.push(`/records/organizations/${saved.id}`);
    else router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {action.error ? (
        <Banner tone="danger">
          {action.error}
          {typeof duplicateId === "number" ? (
            <>
              {" "}
              <Link
                href={`/records/organizations/${duplicateId}`}
                className="font-medium underline"
              >
                {t("openExisting")}
              </Link>
            </>
          ) : null}
        </Banner>
      ) : null}

      <Field label={t("name")} error={nameError} required>
        {(control) => (
          <Input
            name="name"
            value={form.name}
            onChange={(event) => set("name")(event.target.value)}
            maxLength={200}
            autoComplete="off"
            {...control}
          />
        )}
      </Field>

      <Field label={t("address")} error={addressError} required>
        {(control) => (
          <Textarea
            name="address"
            rows={2}
            value={form.address}
            onChange={(event) => set("address")(event.target.value)}
            maxLength={1000}
            {...control}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("country")}>
          {(control) => (
            <Input
              name="country"
              value={form.country}
              onChange={(event) => set("country")(event.target.value)}
              maxLength={100}
              autoComplete="off"
              {...control}
            />
          )}
        </Field>
        <Field label={t("licence")} hint={t("licenceHint")}>
          {(control) => (
            <Input
              name="licenceNumber"
              value={form.licenceNumber}
              onChange={(event) => set("licenceNumber")(event.target.value)}
              maxLength={100}
              autoComplete="off"
              {...control}
            />
          )}
        </Field>
      </div>

      <Field label={t("licenceClass")} hint={t("licenceClassHint")}>
        {(control) => (
          <Select
            name="licenceClass"
            value={form.licenceClass}
            onChange={(event) => set("licenceClass")(event.target.value)}
            {...control}
          >
            <option value="">{t("licenceClassNone")}</option>
            {LICENCE_CLASSES.map((id) => (
              <option key={id} value={id}>
                {domain(`licenceClass.${id}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label={t("notes")} hint={t("notesHint")}>
        {(control) => (
          <Textarea
            name="comment"
            rows={3}
            value={form.comment}
            onChange={(event) => set("comment")(event.target.value)}
            maxLength={2000}
            {...control}
          />
        )}
      </Field>

      {mode === "create" ? (
        <FilePicker
          files={files}
          onChange={setFiles}
          label={t("files")}
          hint={t("filesHint", { size: formatFileSize(MAX_UPLOAD_BYTES) })}
          chosenLabel={t("filesChosen")}
          removeLabel={(name) => t("removeFile", { name })}
          tooLargeText={t("fileTooLarge", { size: formatFileSize(MAX_UPLOAD_BYTES) })}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={action.pending}>
            {t("cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={action.pending}>
          {mode === "create" ? t("create") : t("save")}
        </Button>
      </div>
    </form>
  );
}
