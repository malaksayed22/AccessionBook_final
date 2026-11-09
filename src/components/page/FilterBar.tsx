import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Usage (server component), at the top of every list page:
 *   <FilterBar
 *     search={<SearchForm ... />}
 *     controls={<><SelectFilter ... /><ViewModeToggle ... /></>}
 *   >
 *     <FilterChips label="Status" chips={...} />
 *     <FilterChips label="Type" chips={...} />
 *   </FilterBar>
 * The list's whole toolbar on the page itself, with no box around it: search (grows to fill the
 * row) and its controls (sort, view) on top, then the filter groups centred below as quiet
 * dropdown triggers (see FilterChips), closed by a hairline above the list. Everything wraps, so
 * French copy and phones both fit.
 */
export type FilterBarProps = {
  search?: ReactNode;
  controls?: ReactNode;
  /** Filter groups, usually <FilterChips>. */
  children?: ReactNode;
  className?: string;
};

export function FilterBar({ search, controls, children, className }: FilterBarProps) {
  return (
    <div className={cn("mb-6 space-y-4 border-b border-border pb-5 print:hidden", className)}>
      {search || controls ? (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          {search ? <div className="min-w-64 flex-1">{search}</div> : null}
          {controls ? (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">{controls}</div>
          ) : null}
        </div>
      ) : null}
      {children ? (
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}
