import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Decorative loading indicator. It is hidden from assistive technology on purpose: the component
 * that shows it (Button `loading`, a region with aria-busy) carries the spoken "Loading…" text.
 * Usage: <Spinner className="size-5" />. Stops spinning under prefers-reduced-motion.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={cn("size-4 shrink-0 animate-spin motion-reduce:animate-none", className)}
    />
  );
}
