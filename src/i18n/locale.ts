import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, type AppLocale } from "./routing";

/**
 * First line of every page: validates the `[locale]` segment, tells next-intl which language this
 * request renders in, and returns it. An unknown prefix is a 404.
 */
export async function resolveRequestLocale(
  params: Promise<{ locale: string }>
): Promise<AppLocale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
