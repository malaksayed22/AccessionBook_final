"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { canConfirm, DEFAULT_REASON_MIN_LENGTH } from "./confirm-logic";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { Input, Textarea } from "./FormControls";

/*
 * Usage (irreversible, regulated action):
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Destroy unit U-0042?"
 *     description="This writes a permanent destruction record. It cannot be undone."
 *     confirmLabel="Destroy unit"
 *     requireReason
 *     reasonMinLength={15}
 *     typeToConfirm="U-0042"
 *     onConfirm={async ({ reason }) => { await destroyUnit(id, reason); }}
 *   />
 *
 * `requireReason` adds a mandatory reason; `typeToConfirm` keeps the confirm button disabled until
 * the exact phrase is typed. If `onConfirm` returns a promise the dialog shows the pending state,
 * displays a generic error when it rejects and closes when it resolves. If it returns nothing, the
 * caller owns `pending`, `error` and `open`. While pending the dialog cannot be dismissed.
 */
export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" (default) for destructive actions, "primary" for consequential but safe ones. */
  tone?: "danger" | "primary";
  requireReason?: boolean;
  reasonLabel?: string;
  reasonHint?: ReactNode;
  /** Minimum trimmed length of the reason. Default 10. */
  reasonMinLength?: number;
  /** Phrase the user must type exactly before the confirm button enables. */
  typeToConfirm?: string;
  typeToConfirmLabel?: string;
  /** Externally controlled pending state. */
  pending?: boolean;
  /** Externally controlled error message. */
  error?: ReactNode;
  onConfirm: (result: { reason: string }) => void | Promise<void>;
};

const isPromise = (value: unknown): value is Promise<void> =>
  typeof value === "object" && value !== null && "then" in value;

export function ConfirmDialog({ open, onOpenChange, pending, ...rest }: ConfirmDialogProps) {
  const [internalPending, setInternalPending] = useState(false);
  const busy = Boolean(pending) || internalPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={rest.title}
      description={rest.description}
      dismissible={!busy}
      size="md"
    >
      {/* Mounted only while open, so the typed text and errors reset every time it opens. */}
      <ConfirmForm
        {...rest}
        busy={busy}
        onClose={() => onOpenChange(false)}
        onBusyChange={setInternalPending}
      />
    </Dialog>
  );
}

type ConfirmFormProps = Omit<ConfirmDialogProps, "open" | "onOpenChange" | "pending"> & {
  busy: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};

function ConfirmForm({
  confirmLabel,
  cancelLabel,
  tone = "danger",
  requireReason = false,
  reasonLabel,
  reasonHint,
  reasonMinLength = DEFAULT_REASON_MIN_LENGTH,
  typeToConfirm,
  typeToConfirmLabel,
  error,
  onConfirm,
  busy,
  onClose,
  onBusyChange,
}: ConfirmFormProps) {
  const t = useTranslations("ui");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const allowed = canConfirm({
    reason,
    reasonMinLength,
    requireReason,
    phrase: typeToConfirm,
    typed,
    pending: busy,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!allowed) return;
    setFailure(null);
    try {
      const outcome = onConfirm({ reason: reason.trim() });
      if (!isPromise(outcome)) return;
      onBusyChange(true);
      await outcome;
      onBusyChange(false);
      onClose();
    } catch (cause) {
      console.error("ConfirmDialog: onConfirm failed", cause);
      onBusyChange(false);
      setFailure(t("confirm.failed"));
    }
  };

  const shownError = error ?? failure;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {shownError ? <Banner tone="danger">{shownError}</Banner> : null}

      {requireReason ? (
        <Field
          label={reasonLabel ?? t("confirm.reasonLabel")}
          hint={reasonHint ?? t("confirm.reasonHint", { count: reasonMinLength })}
          required
        >
          {(control) => (
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              {...control}
            />
          )}
        </Field>
      ) : null}

      {typeToConfirm ? (
        <Field
          label={typeToConfirmLabel ?? t("confirm.typeToConfirm", { phrase: `“${typeToConfirm}”` })}
          required
        >
          {(control) => (
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              {...control}
            />
          )}
        </Field>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {cancelLabel ?? t("cancel")}
        </Button>
        <Button
          type="submit"
          variant={tone === "danger" ? "danger" : "primary"}
          loading={busy}
          disabled={!allowed}
        >
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
