"use client";

import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Usage:
 *   <Menu>
 *     <MenuTrigger asChild><IconButton label="Row actions"><Ellipsis /></IconButton></MenuTrigger>
 *     <MenuContent>
 *       <MenuLabel>Unit U-0042</MenuLabel>
 *       <MenuItem onSelect={...}>Place on hold</MenuItem>
 *       <MenuSeparator />
 *       <MenuItem tone="danger" onSelect={...}>Void record</MenuItem>
 *     </MenuContent>
 *   </Menu>
 *
 * Radix handles arrow-key navigation, type-ahead, Esc, focus return to the trigger and
 * collision-aware placement. Use `<MenuItem asChild><Link .../></MenuItem>` for navigation items.
 */
export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...rest
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-[55] min-w-48 max-w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-border bg-raised p-1.5 text-fg shadow-md",
          className
        )}
        {...rest}
      />
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  className,
  tone = "default",
  icon,
  asChild,
  children,
  ...rest
}: ComponentProps<typeof MenuPrimitive.Item> & {
  tone?: "default" | "danger";
  /** Decorative icon before the label. Not available with `asChild`: put the icon in the child. */
  icon?: ReactNode;
}) {
  return (
    <MenuPrimitive.Item
      asChild={asChild}
      className={cn(
        "flex min-h-9 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none select-none pointer-coarse:min-h-11",
        "data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        tone === "danger" ? "text-danger" : "text-fg",
        className
      )}
      {...rest}
    >
      {/* Radix Slot needs exactly one child when asChild is set, so no icon sibling then. */}
      {asChild ? (
        children
      ) : (
        <>
          {icon ? (
            <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-4">
              {icon}
            </span>
          ) : null}
          {children}
        </>
      )}
    </MenuPrimitive.Item>
  );
}

/** A menu item that is on or off, with a tick when on (a column shown, for one). */
export function MenuCheckboxItem({
  className,
  children,
  ...rest
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 rounded-md py-1.5 ps-8 pe-2.5 text-sm text-fg outline-none select-none pointer-coarse:min-h-11",
        "data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...rest}
    >
      <MenuPrimitive.ItemIndicator className="absolute start-2.5 inline-flex">
        <Check aria-hidden="true" className="size-4" />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuSeparator({
  className,
  ...rest
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...rest} />
  );
}

export function MenuLabel({ className, ...rest }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn("px-2.5 py-1.5 text-xs font-medium text-fg-secondary", className)}
      {...rest}
    />
  );
}
