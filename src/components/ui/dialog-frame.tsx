"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";

/*
 * Internal frame shared by Dialog and Sheet (not exported from the barrel): Radix Dialog root,
 * overlay, portal, required title, optional description and the close button. Radix supplies the
 * focus trap, Esc to close, focus restore to the trigger, aria-modal and scroll locking.
 * Entry motion uses CSS transitions with `starting:` styles; they are switched off under
 * prefers-reduced-motion.
 */
export type DialogFrameProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (rendered as the Radix trigger, no wrapper). */
  trigger?: ReactNode;
  /** Required: the dialog's accessible name. */
  title: ReactNode;
  description?: ReactNode;
  /** Keep the title for assistive technology but do not show it. */
  hideTitle?: boolean;
  /** False blocks Esc, outside clicks and the close button (e.g. while a request is pending). */
  dismissible?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  /** Classes of the content panel: position, size, shape, entry motion. */
  panelClassName: string;
  className?: string;
};

export function DialogFrame({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  hideTitle = false,
  dismissible = true,
  children,
  footer,
  panelClassName,
  className,
}: DialogFrameProps) {
  const t = useTranslations("ui");
  const block = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };

  return (
    <DialogPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          // Radix warns when a description is missing; opt out explicitly when there is none.
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "z-50 bg-raised text-fg shadow-lg motion-reduce:transition-none",
            panelClassName,
            className
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={cn("shrink-0 px-5 pt-5 pe-14 sm:px-6 sm:pt-6", hideTitle && "sr-only")}>
              <DialogPrimitive.Title className="text-2xl leading-8 font-serif font-normal tracking-[-0.01em] wrap-break-word">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1.5 text-sm text-fg-secondary wrap-break-word">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
            {footer ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3 sm:px-6">
                {footer}
              </div>
            ) : null}
          </div>
          {dismissible ? (
            <DialogPrimitive.Close asChild>
              <IconButton label={t("close")} size="sm" className="absolute end-3 top-3">
                <X />
              </IconButton>
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
