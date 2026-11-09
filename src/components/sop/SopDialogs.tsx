"use client";

import { FilePen, Paperclip, PenLine, Plus, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { sendForm } from "@/components/actions/use-action-submit";
import { ACCEPTED_SOP_TYPES } from "@/components/experiment/document-upload";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { useRequestAction } from "../use-request-action";

/** Writes a new procedure: its code, title and the text of version 1, as a draft. */
export function NewSopButton() {
  const t = useTranslations("sops.form");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await action.run(() =>
      sendJson<{ sop: { id: number } }>("/api/sops", { code, title, body })
    );
    if (!result.ok) return;
    toast({ tone: "success", title: t("created", { code: code.trim().toUpperCase() }) });
    setOpen(false);
    router.push(`/quality/sops/${result.data.sop.id}`);
  }

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus />}
        onClick={() => {
          action.reset();
          setOpen(true);
        }}
      >
        {t("open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("title")}
        description={t("description")}
        size="lg"
        dismissible={!action.pending}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label={t("code")} hint={t("codeHint")} required>
              {(control) => (
                <Input
                  value={code}
                  maxLength={30}
                  onChange={(event) => setCode(event.target.value)}
                  autoFocus
                  {...control}
                />
              )}
            </Field>
            <Field label={t("name")} required>
              {(control) => (
                <Input
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  {...control}
                />
              )}
            </Field>
          </div>
          <Field label={t("body")} hint={t("bodyHint")} required>
            {(control) => (
              <Textarea
                value={body}
                rows={12}
                onChange={(event) => setBody(event.target.value)}
                {...control}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={action.pending}>
              {t("submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** The procedure's controls: a new draft, approving it, and signing the version in effect. */
export function SopActions({
  sop,
}: {
  sop: {
    id: number;
    code: string;
    /** The text a new draft starts from: the draft's own, or the version in effect. */
    baseBody: string;
    draft: { version: number; changeNote: string | null } | null;
    effectiveVersion: number | null;
    canWrite: boolean;
    canSign: boolean;
    signed: boolean;
  };
}) {
  const t = useTranslations("sops.actions");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [dialog, setDialog] = useState<"draft" | "approve" | "sign" | "attach" | null>(null);
  const [body, setBody] = useState(sop.baseBody);
  const [note, setNote] = useState(sop.draft?.changeNote ?? "");

  async function run(command: Record<string, unknown>, success: string) {
    const result = await action.run(() => sendJson(`/api/sops/${sop.id}`, command, "PATCH"));
    if (!result.ok) return;
    toast({ tone: "success", title: success });
    setDialog(null);
    router.refresh();
  }

  const open = (kind: "draft" | "approve" | "sign" | "attach") => {
    action.reset();
    setBody(sop.baseBody);
    setNote(sop.draft?.changeNote ?? "");
    setDialog(kind);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sop.canSign && !sop.signed ? (
        <Button variant="primary" icon={<PenLine />} onClick={() => open("sign")}>
          {t("sign", { version: sop.effectiveVersion ?? 0 })}
        </Button>
      ) : null}
      {sop.canWrite ? (
        <Button variant="secondary" icon={<FilePen />} onClick={() => open("draft")}>
          {sop.draft ? t("editDraft", { version: sop.draft.version }) : t("newVersion")}
        </Button>
      ) : null}
      {sop.canWrite && sop.draft ? (
        <Button variant="secondary" icon={<Paperclip />} onClick={() => open("attach")}>
          {t("attach")}
        </Button>
      ) : null}
      {sop.canWrite && sop.draft ? (
        <Button variant="secondary" icon={<ShieldCheck />} onClick={() => open("approve")}>
          {t("approve", { version: sop.draft.version })}
        </Button>
      ) : null}

      <Dialog
        open={dialog === "draft"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={t("draftTitle", { code: sop.code })}
        description={t("draftDescription")}
        size="lg"
        dismissible={!action.pending}
      >
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void run({ action: "draft", body, changeNote: note }, t("drafted"));
          }}
        >
          {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
          <Field label={t("changeNote")} hint={t("changeNoteHint")} required>
            {(control) => (
              <Input
                value={note}
                maxLength={1000}
                onChange={(event) => setNote(event.target.value)}
                {...control}
              />
            )}
          </Field>
          <Field label={t("body")} required>
            {(control) => (
              <Textarea
                value={body}
                rows={14}
                onChange={(event) => setBody(event.target.value)}
                {...control}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={action.pending}>
              {t("saveDraft")}
            </Button>
          </div>
        </form>
      </Dialog>

      {dialog === "attach" ? (
        <AttachDialog
          sopId={sop.id}
          version={sop.draft?.version ?? 0}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={t("approveTitle", { code: sop.code, version: sop.draft?.version ?? 0 })}
        description={t("approveBody")}
        confirmLabel={t("approveConfirm")}
        tone="primary"
        pending={action.pending}
        error={action.error}
        onConfirm={() => {
          void run({ action: "approve" }, t("approved"));
        }}
      />
      <ConfirmDialog
        open={dialog === "sign"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={t("signTitle", { code: sop.code, version: sop.effectiveVersion ?? 0 })}
        description={t("signBody")}
        confirmLabel={t("signConfirm")}
        tone="primary"
        pending={action.pending}
        error={action.error}
        onConfirm={() => {
          void run({ action: "sign" }, t("signed"));
        }}
      />
    </div>
  );
}

/** Attaches the controlled document (PDF or Word) to the draft. */
function AttachDialog({
  sopId,
  version,
  onClose,
}: {
  sopId: number;
  version: number;
  onClose: () => void;
}) {
  const t = useTranslations("sops.actions");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
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
    const result = await sendForm(`/api/sops/${sopId}/file`, form);
    setSaving(false);
    if (!result.ok) {
      setFailure(result.network ? networkError : apiError(result.error));
      return;
    }
    toast({ tone: "success", title: t("attached") });
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("attachTitle", { version })}
      description={t("attachDescription")}
      dismissible={!saving}
    >
      <form onSubmit={upload} className="flex flex-col gap-4" noValidate>
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <Field label={t("file")} hint={t("fileHint")} required>
          {(control) => (
            <Input
              ref={input}
              type="file"
              accept={ACCEPTED_SOP_TYPES}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              {...control}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {t("attachSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
