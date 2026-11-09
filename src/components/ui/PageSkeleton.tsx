import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

/*
 * Usage (a route's loading.tsx): export default function Loading() { return <PageSkeleton variant="table" />; }
 * Placeholder shaped like the page that is coming, so the content does not jump when it arrives:
 * a title block, then either a row of stat cards or a toolbar and table rows. The shimmer is plain
 * CSS and stops under prefers-reduced-motion.
 */
type Variant = "table" | "cards";

const bar = "skeleton rounded-md";

export async function PageSkeleton({
  variant = "table",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const t = await getTranslations("common");
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("space-y-8", className)}>
      <span className="sr-only">{t("loading")}</span>

      <div className="space-y-3">
        <div className={cn(bar, "h-9 w-64 max-w-full")} />
        <div className={cn(bar, "h-4 w-96 max-w-full")} />
      </div>

      {variant === "cards" ? (
        <>
          <div className={cn(bar, "h-40 w-full rounded-xl")} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className={cn(bar, "h-36 rounded-xl")} />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className={cn(bar, "h-72 rounded-xl")} />
            <div className={cn(bar, "h-72 rounded-xl")} />
          </div>
        </>
      ) : (
        <>
          <div className={cn(bar, "h-28 w-full rounded-xl")} />
          <div className="space-y-px overflow-hidden rounded-xl border border-border">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className={cn(bar, "h-12 w-full rounded-none")} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
