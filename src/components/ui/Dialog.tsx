"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { DialogFrame, type DialogFrameProps } from "./dialog-frame";

/*
 * Usage (uncontrolled, with its own trigger):
 *   <Dialog trigger={<Button>Edit</Button>} title="Edit location" description="..." footer={<>...</>}>
 *     <form>...</form>
 *   </Dialog>
 *
 * Controlled: <Dialog open={open} onOpenChange={setOpen} title="...">...</Dialog>
 * Close from inside with <DialogClose asChild><Button>Cancel</Button></DialogClose>.
 *
 * Focus is trapped while open, Esc closes it, and focus returns to the trigger (or the element that
 * had focus) on close. `title` is required because every dialog needs an accessible name.
 */
export type DialogProps = Omit<DialogFrameProps, "panelClassName"> & {
  size?: "sm" | "md" | "lg";
};

const SIZE: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Dialog({ size = "md", ...rest }: DialogProps) {
  return (
    <DialogFrame
      panelClassName={cn(
        "fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border",
        "transition-[opacity,scale] duration-150 starting:scale-95 starting:opacity-0",
        SIZE[size]
      )}
      {...rest}
    />
  );
}

export function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />;
}
