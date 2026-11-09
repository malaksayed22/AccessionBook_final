"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

/*
 * Usage (server pages can render it: every prop is plain data):
 *   <ConfirmAction
 *     label="Release" ariaLabel="Release the hold on P-12"
 *     url="/api/units/12/hold" body={{ action: "release" }} reasonField="reason" requireReason
 *     title="Release the hold on P-12?" description="..." confirmLabel="Release hold"
 *     tone="primary" doneMessage="Hold released"
 *   />
 * A button that opens a ConfirmDialog, sends the request through `sendJson` (which asks for the
 * password again when the server requires it), shows the translated error inside the dialog when
 * the server says no, and on success closes, announces a toast and refreshes the page. Nothing
 * changes on screen when the request fails.
 */
export type ConfirmActionProps = {
  label: ReactNode;
  /** Distinguishes rows: the button's accessible name when `label` alone would repeat. */
  ariaLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: ReactNode;
  url: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  /** The key the typed reason is sent under (for example "reason" or "note"). */
  reasonField?: string;
  requireReason?: boolean;
  reasonMinLength?: number;
  reasonLabel?: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  doneMessage: string;
};

export function ConfirmAction({
  label,
  ariaLabel,
  variant = "secondary",
  size = "sm",
  icon,
  url,
  method = "POST",
  body,
  reasonField,
  requireReason = false,
  reasonMinLength,
  reasonLabel,
  title,
  description,
  confirmLabel,
  tone = "danger",
  doneMessage,
}: ConfirmActionProps) {
  const router = useRouter();
  const { toast } = useToast();
  const describe = useApiError();
  const networkMessage = useNetworkError();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(reason: string) {
    setPending(true);
    setError(null);
    const result = await sendJson(
      url,
      { ...body, ...(reasonField ? { [reasonField]: reason } : {}) },
      method
    );
    setPending(false);
    if (!result.ok) {
      setError(result.network ? networkMessage : describe(result.error));
      return;
    }
    setOpen(false);
    toast({ tone: "success", title: doneMessage });
    router.refresh();
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        ref={trigger}
        aria-label={ariaLabel}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // The dialog is opened by state, not by a Radix trigger, so give focus back by hand.
          if (!next) setTimeout(() => trigger.current?.focus(), 0);
        }}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        tone={tone}
        requireReason={requireReason}
        reasonMinLength={reasonMinLength}
        reasonLabel={reasonLabel}
        pending={pending}
        error={error}
        onConfirm={({ reason }) => {
          void run(reason);
        }}
      />
    </>
  );
}
