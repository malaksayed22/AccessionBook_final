"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Children,
  cloneElement,
  createContext,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { clampPage, pageCountFor, pageRange, pageWindow } from "./pagination-logic";

/*
 * Client-side paging for a table whose rows are already on the page (used by DataTable when it has
 * more rows than one page). Three parts share one page number:
 *   <Pager pageSize={10} total={rows.length}>
 *     <PagedItems pageSize={10}>{rowElements}</PagedItems>
 *     <PagerControls />
 *   </Pager>
 * Rows on other pages stay in the document but are not displayed, except when printing, so a printed
 * table still has every row.
 * Lists that come from the server in pages (`?page=2`) use the link-based <Pagination> instead.
 */
type PagerState = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  setPage: (page: number) => void;
};

const PagerContext = createContext<PagerState | null>(null);

function usePager(): PagerState {
  const state = useContext(PagerContext);
  if (!state) throw new Error("Pager parts must be rendered inside <Pager>");
  return state;
}

export function Pager({
  total,
  pageSize,
  children,
}: {
  total: number;
  pageSize: number;
  children: ReactNode;
}) {
  const [requested, setPage] = useState(1);
  const pageCount = pageCountFor(total, pageSize);
  const page = clampPage(requested, pageCount);

  return (
    <PagerContext.Provider value={{ page, pageCount, total, pageSize, setPage }}>
      {children}
    </PagerContext.Provider>
  );
}

/** The rows (or cards) of the current page; every other one is hidden. */
export function PagedItems({ children }: { children: ReactNode }) {
  const { page, pageSize } = usePager();
  return (
    <>
      {Children.toArray(children).map((child, index) => {
        const element = child as ReactElement<{ className?: string }>;
        const offPage = Math.floor(index / pageSize) + 1 !== page;
        // `not-print:hidden` rather than the `hidden` attribute: that one cannot be undone for print.
        return cloneElement(element, {
          className: cn(element.props.className, offPage && "not-print:hidden"),
        });
      })}
    </>
  );
}

export function PagerControls({ className }: { className?: string }) {
  const t = useTranslations("ui");
  const { page, pageCount, total, pageSize, setPage } = usePager();
  if (pageCount <= 1) return null;
  const { from, to } = pageRange(page, pageSize, total);

  return (
    <div
      className={cn(
        "mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 print:hidden",
        className
      )}
    >
      <p aria-live="polite" className="text-sm text-fg-secondary">
        {t("pagination.range", { from, to, total })}
      </p>
      <nav aria-label={t("pagination.label")}>
        <ul className="flex flex-wrap items-center gap-1">
          <li>
            <Button
              variant="secondary"
              size="sm"
              icon={<ChevronLeft />}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t("previous")}
            </Button>
          </li>
          <li className="px-2 text-sm text-fg-secondary sm:hidden">
            {t("pagination.pageOf", { page, pageCount })}
          </li>
          {pageWindow(page, pageCount).map((item) =>
            typeof item === "number" ? (
              <li key={item} className="hidden sm:block">
                <Button
                  variant={item === page ? "primary" : "secondary"}
                  size="sm"
                  aria-label={t("pagination.page", { page: item })}
                  aria-current={item === page ? "page" : undefined}
                  className="min-w-9 px-2 tabular-nums"
                  onClick={() => setPage(item)}
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
            <Button
              variant="secondary"
              size="sm"
              iconAfter={<ChevronRight />}
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              {t("next")}
            </Button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
