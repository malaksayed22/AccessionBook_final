import { CircleAlert, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Link } from "@/i18n/navigation";
import { occupancyLevel, type CapacityMeasure, type OccupancyLevel } from "@/lib/location-capacity";
import { cn } from "@/lib/utils";

/*
 * Usage: <LocationOccupancy name="Room 2" units={12} capacity={20} />
 * A meter with its numbers written out underneath ("12 of 20 units (60%)"), plus a labelled badge
 * with its own icon when the room is nearly full, full or over capacity. State is never carried by
 * the bar's colour alone. Without a capacity there is nothing to compare, so only the count shows.
 */
const FILL: Record<OccupancyLevel, string> = {
  unlimited: "bg-accent",
  ok: "bg-accent",
  near: "bg-warning-solid",
  full: "bg-warning-solid",
  over: "bg-danger-solid",
};

export function LocationOccupancy({
  name,
  units,
  capacity,
  measure = "UNITS",
  href,
  className,
}: {
  name: string;
  /** What is stored, in `measure`: units, plants or grams. */
  units: number;
  capacity: number | null;
  measure?: CapacityMeasure;
  /** Makes the meter and its figures a link, e.g. to the units kept in this room. */
  href?: string;
  className?: string;
}) {
  const t = useTranslations("locations.occupancy");
  const level = occupancyLevel(units, capacity);

  // Weights are stored in grams and read in kilograms.
  const shown = (value: number) => (measure === "WEIGHT" ? value / 1000 : value);
  const key = measure === "PLANTS" ? "Plants" : measure === "WEIGHT" ? "Weight" : "";

  if (capacity === null || level === "unlimited") {
    const text = t(`unlimited${key}`, { units: shown(units) });
    return (
      <p className={cn("text-sm tabular-nums", className)}>
        {href ? (
          <Link href={href} className="text-accent-text hover:underline">
            {text}
          </Link>
        ) : (
          text
        )}
      </p>
    );
  }

  const ratio = units / capacity;
  const summary = t(`summary${key}`, { units: shown(units), capacity: shown(capacity), ratio });
  const width = `${Math.min(100, Math.round(ratio * 100))}%`;

  const meter = (
    <>
      <div
        role="meter"
        aria-label={t("label", { name })}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={Math.min(units, capacity)}
        aria-valuetext={summary}
        className="h-2 w-full overflow-hidden rounded-full border border-border bg-sunken"
      >
        <div className={cn("h-full rounded-full", FILL[level])} style={{ width }} />
      </div>
      <p className={cn("text-sm tabular-nums", href && "text-accent-text")}>{summary}</p>
    </>
  );

  return (
    <div className={cn("flex min-w-44 flex-col gap-1", className)}>
      {href ? (
        <Link href={href} className="flex flex-col gap-1 hover:underline">
          {meter}
        </Link>
      ) : (
        meter
      )}
      {level === "ok" ? null : (
        <Badge
          tone={level === "over" ? "danger" : "warning"}
          icon={level === "over" ? <CircleAlert /> : <TriangleAlert />}
          className="self-start"
        >
          {t(`level.${level}`)}
        </Badge>
      )}
    </div>
  );
}
