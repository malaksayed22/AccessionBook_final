import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Usage:
 *   <PageHeader
 *     breadcrumbs={<Breadcrumbs items={...} />}
 *     kicker="Inventory"
 *     title="Units"
 *     description="Everything in custody"
 *     actions={<Button variant="primary">New unit</Button>}
 *   />
 * Renders the page's one <h1>. Title and actions wrap, so longer French copy never overflows.
 */
export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  /** Small mono line above the title, as on the public site's section openings. */
  kicker?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  kicker,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 pb-8", className)}>
      {breadcrumbs}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-96">
          {kicker ? (
            <p className="mb-3 font-mono text-xs tracking-[0.14em] text-accent-text uppercase">
              {kicker}
            </p>
          ) : null}
          <h1 className="text-2xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg wrap-break-word sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-base text-pretty text-fg-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
