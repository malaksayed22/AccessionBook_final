import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { DM_Mono, Instrument_Serif, Inter } from "next/font/google";
import { NonceBridge } from "@/components/NonceBridge";
import { ThemeProvider } from "@/components/ThemeProvider";
import { BRAND } from "@/lib/brand";
import { clientMessages } from "@/i18n/messages";
import { routing } from "@/i18n/routing";
import { parseTheme, THEME_COOKIE, themeAttribute } from "@/lib/theme";
import { env } from "@/server/env";
import "../globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/** One accent word per headline, set in italic serif (see the hero). */
const serif = Instrument_Serif({
  variable: "--font-serif-accent",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const siteUrl = env().APP_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
  },
  // Inventory, lineage and custody data must never surface in search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#04070f" },
    { media: "(prefers-color-scheme: light)", color: "#eff3fc" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [messages, t, cookieStore, requestHeaders] = await Promise.all([
    getMessages(),
    getTranslations("common"),
    cookies(),
    headers(),
  ]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html
      lang={locale}
      data-theme={themeAttribute(theme)}
      className={`${inter.variable} ${serif.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-accent"
        >
          {t("skipToContent")}
        </a>
        <NonceBridge nonce={nonce} />
        <NextIntlClientProvider locale={locale} messages={clientMessages(messages)}>
          <ThemeProvider initial={theme}>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
