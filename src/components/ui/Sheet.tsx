"use client";

import { cn } from "@/lib/utils";
import { DialogFrame, type DialogFrameProps } from "./dialog-frame";

/*
 * Usage (mobile navigation drawer):
 *   <Sheet side="left" trigger={<IconButton label="Open menu"><Menu /></IconButton>} title="Navigation">
 *     <nav>...</nav>
 *   </Sheet>
 *
 * Same behaviour as Dialog (focus trap, Esc, focus restore, required title); it slides in from the
 * edge instead of centring, and is full height. Close it from inside with <DialogClose asChild>.
 */
export type SheetProps = Omit<DialogFrameProps, "panelClassName"> & {
  side?: "left" | "right";
};

export function Sheet({ side = "left", ...rest }: SheetProps) {
  return (
    <DialogFrame
      panelClassName={cn(
        "fixed inset-y-0 flex w-[min(22rem,calc(100vw-2.5rem))] translate-x-0 flex-col border-border",
        "transition-[translate] duration-200",
        side === "left"
          ? "left-0 border-r starting:-translate-x-full"
          : "right-0 border-l starting:translate-x-full"
      )}
      {...rest}
    />
  );
}
