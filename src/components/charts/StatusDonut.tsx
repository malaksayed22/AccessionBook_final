import type { ReactNode } from "react";
import { DonutChart, type DonutSlice } from "@/components/charts/DonutChart";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";

/**
 * A page's status summary: one donut in a panel, in place of a row of number cards (the team lead's
 * rule for the whole system). Each slice can link to the list filtered by it. Slices with nothing in
 * them are left out of the ring; with nothing at all, `empty` shows instead.
 */
export function StatusDonut({
  title,
  slices,
  centerValue,
  centerLabel,
  empty,
  footer,
  className,
}: {
  title: string;
  slices: DonutSlice[];
  centerValue: string;
  centerLabel: string;
  empty?: ReactNode;
  /** A line under the chart for figures that are not part of the ring. */
  footer?: ReactNode;
  className?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <section aria-label={title} className={cn("mb-6 lg:max-w-2xl", className)}>
      <Panel className="chart-glow">
        <PanelHeader title={title} headingLevel={2} />
        <PanelBody className="space-y-4">
          {total === 0 && empty ? (
            empty
          ) : (
            <DonutChart
              label={title}
              slices={slices}
              centerValue={centerValue}
              centerLabel={centerLabel}
            />
          )}
          {footer ? <div className="text-sm text-fg-secondary">{footer}</div> : null}
        </PanelBody>
      </Panel>
    </section>
  );
}
