import { defineRouting } from "next-intl/routing";

/**
 * English and Canadian French, both with a URL prefix (`/en/...`, `/fr/...`) so a link always says
 * which language it shows. The first visit negotiates from Accept-Language; the choice is then
 * remembered in a cookie by next-intl.
 */
export const routing = defineRouting({
  locales: ["en", "fr"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];

/** Region used for number, date and currency formatting (Quebec conventions for French). */
export const LOCALE_REGION: Record<AppLocale, string> = {
  en: "en-CA",
  fr: "fr-CA",
};
