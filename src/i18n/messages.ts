import type { AppLocale } from "./routing";

/**
 * Messages are split into one JSON file per area (`messages/<locale>/<area>.json`) so several people
 * can work on different areas without colliding. The file name is the top-level namespace:
 * `ui.json` -> `useTranslations("ui")`. Add a new area here and in `global.d.ts`.
 */
export const MESSAGE_AREAS = [
  "common",
  "ui",
  "shell",
  "auth",
  "errors",
  "profile",
  "domain",
  "dashboard",
  "overview",
  "units",
  "experiments",
  "materials",
  "qa",
  "recall",
  "destroyed",
  "locations",
  "cultivars",
  "organizations",
  "members",
  "reports",
  "recordPdf",
  "settings",
  "labels",
  "tasks",
  "notifications",
  "sops",
  "activity",
  "search",
  "actions",
  "marketing",
] as const;
export type MessageArea = (typeof MESSAGE_AREAS)[number];

/**
 * Areas only ever read in server components. They are never sent to the browser, which keeps each
 * page's payload smaller. `messages.test.ts` fails if a client component starts using one.
 */
export const SERVER_ONLY_AREAS = [
  "dashboard",
  "overview",
  "recall",
  "destroyed",
  "search",
  "activity",
  "recordPdf",
] as const satisfies readonly MessageArea[];

/** The messages the browser needs. */
export function clientMessages<T extends Record<string, unknown>>(messages: T): Partial<T> {
  const hidden = new Set<string>(SERVER_ONLY_AREAS);
  return Object.fromEntries(
    Object.entries(messages).filter(([area]) => !hidden.has(area))
  ) as Partial<T>;
}

export async function loadMessages(locale: AppLocale) {
  const entries = await Promise.all(
    MESSAGE_AREAS.map(
      async (area) =>
        [area, (await import(`../../messages/${locale}/${area}.json`)).default] as const
    )
  );
  return Object.fromEntries(entries) as Record<MessageArea, Record<string, unknown>>;
}
