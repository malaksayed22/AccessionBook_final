import { createFormatter, createTranslator } from "next-intl";
import { FORMATS } from "@/i18n/formats";
import { loadMessages } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import { env } from "@/server/env";

/**
 * `next-intl/server` outside Next.js, for tests of server code that writes text (the PDF records):
 * the same messages, clock and formats as the app's request config. Use with
 * `vi.mock("next-intl/server", () => import("../stubs/next-intl-server"))`.
 */
export async function getTranslations({
  locale,
  namespace,
}: {
  locale: AppLocale;
  namespace?: string;
}) {
  return createTranslator({
    locale,
    messages: (await loadMessages(locale)) as never,
    namespace: namespace as never,
    timeZone: env().LAB_TIMEZONE,
    formats: FORMATS,
  });
}

export async function getFormatter({ locale }: { locale: AppLocale }) {
  return createFormatter({ locale, timeZone: env().LAB_TIMEZONE, formats: FORMATS });
}
