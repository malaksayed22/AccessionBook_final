"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import type { ActionId } from "@/lib/action-catalog";
import { ActionPanel } from "./ActionPanel";
import type { ActionContext } from "./types";

type ActionDialogProps = {
  context: ActionContext;
  initialAction?: ActionId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opens the dialog; focus returns to it on close. */
  trigger?: ReactNode;
};

/**
 * The "Take action" dialog. Built on the design-system Dialog, so the focus trap, Escape, focus
 * return to the trigger and the accessible name come from there. While a request is running the
 * dialog cannot be dismissed, so a destruction or shipment is never abandoned half-way.
 */
export function ActionDialog({
  context,
  initialAction,
  open,
  onOpenChange,
  trigger,
}: ActionDialogProps) {
  const t = useTranslations("actions");
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const description =
    context.scope === "unit"
      ? t("launcher.scope.unit", { name: context.unitName ?? "" })
      : context.scope === "experiment"
        ? context.experimentCode
          ? t("launcher.scope.experiment", {
              code: context.experimentCode,
              name: context.experimentName ?? "",
            })
          : t("launcher.scope.experimentUnknown")
        : t("launcher.scope.global");

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title={initialAction ? t(`items.${initialAction}.title`) : t("launcher.title")}
      description={description}
      size="lg"
      dismissible={!busy}
    >
      <ActionPanel
        context={context}
        initialAction={initialAction}
        onClose={close}
        onBusyChange={setBusy}
      />
    </Dialog>
  );
}
