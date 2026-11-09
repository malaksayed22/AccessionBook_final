import { useFormatter, useTranslations } from "next-intl";

type Segment = {
  id: string;
  label: string;
  count: number;
  /** Category colour from `lib/lifecycle-stages` (chart data, not interface chrome). */
  color: string;
};

/**
 * Stacked bar of how many active units are in each lifecycle stage. Each stage is also named in the
 * legend with its count, so colour is never the only way to read it.
 */
export function LifecycleTimeline({
  segments,
  startDate,
  dominantLabel,
  activeTotal,
  emptyLabel,
}: {
  segments: Segment[];
  startDate?: Date | string | null;
  dominantLabel?: string | null;
  activeTotal?: number;
  emptyLabel?: string;
}) {
  const t = useTranslations("units.lifecycle");
  const format = useFormatter();
  const visible = segments.filter((s) => s.count > 0);
  const total = activeTotal ?? visible.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return <p className="text-xs text-fg-secondary">{emptyLabel ?? t("empty")}</p>;
  }

  const dominant = visible.find((s) => s.label === dominantLabel) ?? visible[0];
  const started = startDate ? new Date(startDate) : null;

  return (
    <div className="space-y-2">
      {started ? (
        <div className="flex items-center justify-between text-xs text-fg-secondary">
          <span>{t("started", { date: format.dateTime(started, "date") })}</span>
          <span>{t("active", { count: total })}</span>
        </div>
      ) : null}

      <div className="flex h-3 overflow-hidden rounded-full bg-sunken" aria-hidden>
        {visible.map((segment) => (
          <div
            key={segment.id}
            style={{
              flex: segment.count,
              backgroundColor: segment.color,
              opacity: segment.label === dominantLabel ? 1 : 0.72,
            }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-fg-secondary">
          {t("stageMix")}{" "}
          <span className="font-medium text-fg">{dominantLabel || dominant?.label || "—"}</span>
        </span>
        {!started ? (
          <span className="text-fg-secondary">{t("active", { count: total })}</span>
        ) : null}
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {visible.map((segment) => (
          <li key={segment.id} className="inline-flex items-center gap-1 text-xs text-fg-secondary">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            {segment.label} {segment.count}
          </li>
        ))}
      </ul>
    </div>
  );
}
