import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Plus_Jakarta_Sans } from "next/font/google";
import { BrandLogo } from "@/components/BrandLogo";
import { ContactLinks } from "@/components/marketing/ContactLinks";
import { CONTACT } from "@/components/marketing/contact";
import { LandingHero } from "@/components/marketing/LandingHero";
import { PhotoPlaceholders, VideoSection } from "@/components/marketing/LandingMedia";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { PillLink } from "@/components/marketing/PillLink";
import { RecordList } from "@/components/marketing/RecordList";
import { SOFT_TEXT } from "@/components/marketing/softText";
import { resolveRequestLocale } from "@/i18n/locale";
import { routing } from "@/i18n/routing";
import { getSessionUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The share card is a file route at the site root (see app/opengraph-image.tsx). It sits above the
 * root layout, so Next does not attach it to this page on its own.
 */
const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${BRAND.name} · ${BRAND.tagline}`,
};

/**
 * The landing page sets its own text in Plus Jakarta Sans. The font is loaded here, so only this
 * route ships it; the app keeps Inter. The italic serif accents and the mono labels keep theirs.
 */
const landingSans = Plus_Jakarta_Sans({
  variable: "--font-landing",
  subsets: ["latin"],
  display: "swap",
});

type Props = { params: Promise<{ locale: string }> };

/**
 * The root layout marks the whole site `noindex` so no signed-in page can be crawled. This is the
 * one public page, so it opts back in, in each language, and says where its translation lives.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveRequestLocale(params);
  const t = await getTranslations({ locale, namespace: "marketing.meta" });
  const languages = Object.fromEntries(routing.locales.map((code) => [code, `/${code}`]));

  return {
    title: { absolute: `${BRAND.name} · ${t("title")}` },
    description: t("description"),
    robots: { index: true, follow: true },
    alternates: { canonical: `/${locale}`, languages },
    openGraph: {
      type: "website",
      siteName: BRAND.name,
      title: `${BRAND.name} · ${t("title")}`,
      description: t("description"),
      url: `/${locale}`,
      locale: locale === "fr" ? "fr_CA" : "en_CA",
      alternateLocale: locale === "fr" ? ["en_CA"] : ["fr_CA"],
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: `${BRAND.name} · ${t("title")}`,
      description: t("description"),
      images: [SHARE_IMAGE.url],
    },
  };
}

export default async function HomePage({ params }: Props) {
  const locale = await resolveRequestLocale(params);
  const [user, t] = await Promise.all([
    getSessionUser(),
    getTranslations({ locale, namespace: "marketing" }),
  ]);
  const signedIn = user !== null;

  return (
    <div
      className={cn(
        "min-h-screen bg-bg text-fg [font-family:var(--font-landing),system-ui,sans-serif] [word-spacing:0.05em]",
        landingSans.variable,
        SOFT_TEXT
      )}
    >
      <MarketingHeader signedIn={signedIn} />

      <main id="main" tabIndex={-1} className="outline-none">
        <LandingHero />

        <VideoSection />

        <section
          id="compliance"
          aria-labelledby="compliance-title"
          className="scroll-mt-20 border-b border-border bg-surface py-20 sm:py-24"
        >
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
            <div>
              <SectionHeading
                id="compliance-title"
                kicker={t("compliance.kicker")}
                title={t("compliance.title")}
                titleAccent={t("compliance.titleAccent")}
              />
              <p className="mt-6 text-lg leading-relaxed text-fg-secondary">{t("compliance.p1")}</p>
              <p className="mt-4 leading-relaxed text-fg-secondary">{t("compliance.p2")}</p>
            </div>
            <RecordList />
          </div>
        </section>

        <PhotoPlaceholders />

        <section aria-labelledby="cta-title" className="bg-surface pt-20 pb-8 sm:pt-24 sm:pb-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <div className="max-w-3xl">
                <p className="mb-4 font-mono text-xs tracking-[0.14em] text-accent-text uppercase">
                  {t("cta.kicker")}
                </p>
                <h2
                  id="cta-title"
                  className="text-4xl leading-[1.04] font-semibold tracking-[-0.025em] text-balance sm:text-5xl lg:text-7xl"
                >
                  {t("cta.title")}{" "}
                  <span className="font-serif font-normal tracking-[-0.02em] text-accent-text italic">
                    {t("cta.titleAccent")}
                  </span>
                </h2>
                <p className="mt-6 max-w-2xl text-base leading-relaxed text-fg-secondary sm:text-lg">
                  {t("cta.body")}
                </p>
              </div>
              <PillLink href={CONTACT.bookingUrl} size="lg" className="max-sm:w-full">
                {t("cta.book")}
              </PillLink>
            </div>
            <ContactLinks className="mt-16 sm:mt-24" />
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 text-center text-xs text-fg-secondary sm:flex-row sm:px-6 sm:text-start">
          <BrandLogo size="sm" />
          <p>
            {t("footer.subtitle")} ·{" "}
            {t("footer.copyright", { year: String(new Date().getFullYear()) })}
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Kicker and a large heading whose last words are set in the italic serif. Nothing animated. */
function SectionHeading({
  id,
  kicker,
  title,
  titleAccent,
}: {
  id: string;
  kicker: string;
  title: string;
  titleAccent: string;
}) {
  return (
    <div>
      <p className="mb-4 font-mono text-xs tracking-[0.14em] text-accent-text uppercase">
        {kicker}
      </p>
      <h2
        id={id}
        className="text-4xl leading-[1.04] font-semibold tracking-[-0.025em] text-balance sm:text-5xl lg:text-6xl"
      >
        {title}{" "}
        <span className="font-serif font-normal tracking-[-0.02em] text-accent-text italic">
          {titleAccent}
        </span>
      </h2>
    </div>
  );
}
