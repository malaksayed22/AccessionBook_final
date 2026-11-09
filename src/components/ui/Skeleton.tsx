import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * Usage: <div aria-busy="true"><Skeleton className="h-6 w-48" /><SkeletonText lines={3} /></div>
 * Placeholder blocks are hidden from assistive technology; put aria-busy (and, where a screen
 * reader user needs to be told, a visually hidden "Loading…") on the container. The pulse stops
 * under prefers-reduced-motion.
 */
export function Skeleton({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-hover motion-reduce:animate-none", className)}
      {...rest}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn("h-4", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
