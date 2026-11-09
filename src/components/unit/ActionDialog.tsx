"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import type { ApiResult } from "@/lib/client-api";
import { useTranslations } from "next-intl";

/*
 * The shell every unit action form shares: a dialog with a form, a pending state that blocks
 * dismissal, a translated error banner (from the API's error code), a success toast, and a refresh
 * of the page data once the server has accepted the change. Nothing is closed or navigated on a
 * failed request. Mount it only while open, so each opening starts with an empty form.
 */
export type ActionDialogProps<T> = {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  /** "danger" for destructive steps. */
  tone?: "primary" | "danger";
  /** False keeps the submit button disabled (a required field is still empty). */
  canSubmit?: boolean;
  size?: "sm" | "md" | "lg";
  /** Sends the request. Returns the typed result of `sendJson`. */
  send: () => Promise<ApiResult<T>>;
  /** Text of the success toast. */
  successTitle: (data: T) => string;
  /** Runs after success, once the dialog is closed (for example to open the new unit). */
  onDone?: (data: T) => void;
  onClose: () => void;
  children: ReactNode;
};

export function ActionDialog<T>({
  title,
  description,
  submitLabel,
  tone = "primary",
  canSubmit = true,
  size = "md",
  send,
  successTitle,
  onDone,
  onClose,
  children,
}: ActionDialogProps<T>) {
  const t = useTranslations("units.actions");
  const formId = useId();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !canSubmit) return;
    setPending(true);
    setFailure(null);
    const result = await send();
    setPending(false);
    if (!result.ok) {
      setFailure(
        result.network
          ? networkError
          : result.error?.bulkUnit
            ? `${apiError(result.error)} ${t("stoppedBy", { name: result.error.bulkUnit })}`
            : apiError(result.error)
      );
      return;
    }
    toast({ tone: "success", title: successTitle(result.data) });
    onClose();
    router.refresh();
    onDone?.(result.data);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={title}
      description={description}
      dismissible={!pending}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={tone === "danger" ? "danger" : "primary"}
            loading={pending}
            disabled={!canSubmit}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        {children}
      </form>
    </Dialog>
  );
}
