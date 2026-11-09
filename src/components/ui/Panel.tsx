import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Usage:
 *   <Panel>
 *     <PanelHeader title="Recent activity" description="Last 30 days" actions={<Button>Export</Button>} />
 *     <PanelBody>...</PanelBody>
 *   </Panel>
 * Surface container. Server-friendly. `headingLevel` keeps the document outline correct.
 */
export function Panel({ className, ...rest }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "relative rounded-xl border border-border bg-surface shadow-sm before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,var(--color-accent-text),transparent)] before:opacity-40",
        className
      )}
      {...rest}
    />
  );
}

export type PanelHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

export function PanelHeader({
  title,
  description,
  actions,
  headingLevel = 2,
  className,
}: PanelHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-t-xl border-b border-border bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-accent-soft)_70%,transparent),transparent)] px-5 py-4 sm:px-6",
        className
      )}
    >
      <div className="min-w-0 flex-1 basis-56">
        <Heading className="text-base leading-6 font-semibold tracking-[-0.015em] text-fg wrap-break-word">
          {title}
        </Heading>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-fg-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("p-5 sm:p-6", className)} {...rest} />;
}
