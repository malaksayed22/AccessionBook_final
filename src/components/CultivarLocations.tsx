"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { LocationSummaryButton } from "@/components/LocationSummaryButton";

/** The places shown before "+N more". */
const SHOWN = 3;

/**
 * Where a cultivar's units are stored: the first few places as buttons, and "+N more" that opens the
 * rest in place (and "Show fewer" to fold them again). Each place opens its own summary.
 */
export function CultivarLocations({
  cultivarId,
  places,
}: {
  cultivarId: number;
  places: Array<{ id: number; name: string; count: number }>;
}) {
  const t = useTranslations("cultivars.card");
  const [all, setAll] = useState(false);
  const listId = useId();
  const shown = all ? places : places.slice(0, SHOWN);
  const more = places.length - SHOWN;

  return (
    <ul id={listId} className="flex flex-wrap gap-1.5">
      {shown.map((place) => (
        <li key={place.id} className="min-w-0">
          <LocationSummaryButton
            locationId={place.id}
            name={place.name}
            count={place.count}
            cultivarId={cultivarId}
          />
        </li>
      ))}
      {more > 0 ? (
        <li className="self-center">
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((value) => !value)}
            className="rounded-md px-1.5 py-1 text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {all ? t("showFewer") : t("morePlaces", { count: more })}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
