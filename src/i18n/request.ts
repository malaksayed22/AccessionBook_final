import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { env } from "@/server/env";
import { FORMATS } from "./formats";
import { loadMessages } from "./messages";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: await loadMessages(locale),
    // Zones are explicit so server and browser render the same clock.
    timeZone: env().LAB_TIMEZONE,
    formats: FORMATS,
  };
});
