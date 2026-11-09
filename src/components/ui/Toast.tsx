"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";
import { softTone } from "./styles";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  toast,
  type ToastTone,
} from "./toast-store";

/*
 * Usage:
 *   1. Render <Toaster /> once, near the root of the signed-in layout.
 *   2. Anywhere in client code:  const { toast } = useToast();
 *                                toast({ tone: "success", title: "Saved", description: "..." });
 *
 * Toasts are announced politely (Radix `type="background"`, a visually hidden live region), pause
 * while hovered or focused, and can be dismissed from the keyboard (F8 focuses the viewport, Esc
 * dismisses). Each tone has an icon and a spoken tone name. Do not use a toast for information the
 * user must act on: use a Banner or an inline error for that.
 */
const TONE_ICON: Record<ToastTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
};

const ICON_COLOUR: Record<ToastTone, string> = {
  info: softTone.info,
  success: softTone.success,
  warning: softTone.warning,
  danger: softTone.danger,
};

export function useToast() {
  return { toast, dismiss: dismissToast };
}

export function Toaster() {
  const t = useTranslations("ui");
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={6000}>
      {toasts.map((item) => {
        const Icon = TONE_ICON[item.tone];
        return (
          <ToastPrimitive.Root
            key={item.id}
            type="background"
            duration={item.duration}
            onOpenChange={(open) => {
              if (!open) dismissToast(item.id);
            }}
            className="flex items-start gap-3 rounded-xl border border-border bg-raised p-3 text-fg shadow-md transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border",
                ICON_COLOUR[item.tone]
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <ToastPrimitive.Title className="font-semibold wrap-break-word">
                <span className="sr-only">{t(`tone.${item.tone}`)}: </span>
                {item.title}
              </ToastPrimitive.Title>
              {item.description ? (
                <ToastPrimitive.Description className="mt-0.5 text-fg-secondary wrap-break-word">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close asChild>
              <IconButton label={t("dismiss")} size="sm" className="-m-1">
                <X />
              </IconButton>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport
        label={t("toast.viewport")}
        className="fixed inset-x-0 bottom-0 z-[60] m-0 flex max-h-dvh w-full max-w-sm list-none flex-col gap-2 p-4 outline-none sm:inset-x-auto sm:right-0"
      />
    </ToastPrimitive.Provider>
  );
}
