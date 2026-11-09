"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

/*
 * Usage:
 *   <Tabs defaultValue="details">
 *     <TabsList label="Unit sections">
 *       <TabsTrigger value="details">Details</TabsTrigger>
 *       <TabsTrigger value="history">History</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="details">...</TabsContent>
 *     <TabsContent value="history">...</TabsContent>
 *   </Tabs>
 *
 * Radix gives the WAI-ARIA tabs pattern: roving tabindex, Left/Right (Up/Down when vertical),
 * Home/End, automatic activation. The list scrolls sideways instead of wrapping when the labels
 * are long (French).
 */
export function Tabs({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn("flex flex-col", className)} {...rest} />;
}

export function TabsList({
  label,
  className,
  ...rest
}: Omit<ComponentProps<typeof TabsPrimitive.List>, "aria-label"> & {
  /** Accessible name of the tab list. */
  label: string;
}) {
  return (
    <TabsPrimitive.List
      aria-label={label}
      className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}
      {...rest}
    />
  );
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-fg-secondary",
        "transition-colors duration-150 motion-reduce:transition-none hover:text-fg",
        "data-[state=active]:border-accent-text data-[state=active]:font-semibold data-[state=active]:text-accent-text",
        "disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11",
        focusRing,
        "focus-visible:-outline-offset-2",
        className
      )}
      {...rest}
    />
  );
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content className={cn("mt-4 rounded-lg", focusRing, className)} {...rest} />
  );
}
