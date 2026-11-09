"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ActionBootstrap } from "@/features/action/types";
import type { Choice } from "./fields";

/** Picker options for the action forms, labelled in the current language. */
export function useBootstrapOptions(bootstrap: ActionBootstrap) {
  const t = useTranslations("actions.fields");

  return useMemo(
    () => ({
      experiments: bootstrap.experiments.map((experiment): Choice => ({
        value: String(experiment.id),
        label: t("experimentOption", { code: experiment.ecode, name: experiment.name }),
      })),
      cultivars: bootstrap.cultivars.map((cultivar): Choice => ({
        value: String(cultivar.id),
        label: cultivar.name,
      })),
      locations: bootstrap.locations.map((location): Choice => ({
        value: String(location.id),
        label:
          location.capacity === null
            ? location.name
            : t("locationOption", {
                name: location.name,
                used: location.occupancy,
                capacity: location.capacity,
              }),
      })),
      organizations: bootstrap.organizations.map((organization): Choice => ({
        value: String(organization.id),
        label: organization.name,
      })),
    }),
    [bootstrap, t]
  );
}

/** `{ value, label }` pairs for a list of enum keys, labelled from a `domain.*` namespace. */
export function choicesFrom<K extends string>(
  keys: readonly K[],
  label: (key: K) => string
): Choice[] {
  return keys.map((key) => ({ value: key, label: label(key) }));
}
