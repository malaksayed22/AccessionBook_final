import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button, buttonStyles } from "./Button";
import { clampPage, pageCountFor, pageRange, pageWindow } from "./pagination-logic";

/*
 * Usage (server component; the page number lives in the URL):
 *   <Pagination page={page} pageSize={25} total={130} buildHref={(p) => `/inventory/units?page=${p}`} />
 *
 * Link based, so it works without JavaScript. Shows the visible range ("1–25 of 130"), previous and
 * next, and a window of page numbers on wider screens (a short "Page 2 of 6" on narrow ones). The
 * current page has aria-current="page"; unavailable previous/next are marked aria-disabled.
 */
export type PaginationProps = {
  /** Current 1-based page. Out-of-range values are clamped. */
  page: number;
  pageSize: number;
  total: number;
  buildHref: (page: number) => string;
  className?: string;
};

export function Pagination({ page, pageSize, total, buildHref, className }: PaginationProps) {
  const t = useTranslations("ui");
  if (total <= 0) return null;

  const pageCount = pageCountFor(total, pageSize);
  const current = clampPage(page, pageCount);
  const { from, to } = pageRange(current, pageSize, total);
  const disabledStyle = cn(buttonStyles({ variant: "secondary", size: "sm" }), "px-3");

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}>
      <p className="text-sm text-fg-secondary">{t("pagination.range", { from, to, total })}</p>

      {pageCount > 1 ? (
        <nav aria-label={t("pagination.label")}>
          <ul className="flex flex-wrap items-center gap-1">
            <li>
              {current > 1 ? (
                <Button
                  href={buildHref(current - 1)}
                  rel="prev"
                  variant="secondary"
                  size="sm"
                  icon={<ChevronLeft />}
                >
                  {t("previous")}
                </Button>
              ) : (
                <span aria-disabled="true" className={disabledStyle}>
                  <ChevronLeft aria-hidden="true" className="size-4" />
                  {t("previous")}
                </span>
              )}
            </li>

            <li className="px-2 text-sm text-fg-secondary sm:hidden">
              {t("pagination.pageOf", { page: current, pageCount })}
            </li>

            {pageWindow(current, pageCount).map((item) =>
              typeof item === "number" ? (
                <li key={item} className="hidden sm:block">
                  <Button
                    href={buildHref(item)}
                    variant={item === current ? "primary" : "secondary"}
                    size="sm"
                    aria-label={t("pagination.page", { page: item })}
                    aria-current={item === current ? "page" : undefined}
                    className="min-w-9 px-2 tabular-nums"
                  >
                    {item}
                  </Button>
                </li>
              ) : (
                <li key={item} aria-hidden="true" className="hidden px-1 text-fg-tertiary sm:block">
                  …
                </li>
              )
            )}

            <li>
              {current < pageCount ? (
                <Button
                  href={buildHref(current + 1)}
                  rel="next"
                  variant="secondary"
                  size="sm"
                  iconAfter={<ChevronRight />}
                >
                  {t("next")}
                </Button>
              ) : (
                <span aria-disabled="true" className={disabledStyle}>
                  {t("next")}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </span>
              )}
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
