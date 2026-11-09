import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

/*
 * Usage: <Breadcrumbs items={[{ label: "Units", href: "/inventory/units" }, { label: "U-0042" }]} />
 * The last item is the current page: plain text with aria-current="page". Server-friendly.
 */
export type BreadcrumbItem = { label: string; href?: string };

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  const t = useTranslations("ui");
  const lastIndex = items.length - 1;

  return (
    <nav aria-label={t("breadcrumbs.label")} className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-secondary">
        {items.map((item, index) => {
          const isCurrent = index === lastIndex;
          return (
            <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-1.5">
              {item.href && !isCurrent ? (
                <Link
                  href={item.href}
                  className={cn(
                    "rounded-sm underline-offset-2 hover:text-fg hover:underline",
                    focusRing
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn("wrap-break-word", isCurrent && "font-medium text-fg")}
                >
                  {item.label}
                </span>
              )}
              {isCurrent ? null : (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-fg-tertiary rtl:rotate-180"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
