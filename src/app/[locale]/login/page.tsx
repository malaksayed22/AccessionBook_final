import { GitBranch, Lock, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { BrandWordmark } from "@/components/BrandLogo";
import { LoginForm } from "@/components/LoginForm";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { BRAND } from "@/lib/brand";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "auth.login",
  });
  return { title: t("pageTitle") };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  await resolveRequestLocale(params);
  const t = await getTranslations("auth.login");
  const hero = await getTranslations("marketing.hero");

  // A half-finished sign-in resumes where it stopped instead of asking for the password again.
  const pending = await getSession();
  const initialStep =
    pending?.state === "mfa-required"
      ? "code"
      : pending?.state === "mfa-enrolment-required"
        ? "enrol"
        : "credentials";

  const highlights = [
    { icon: GitBranch, label: t("highlights.lineage") },
    { icon: Lock, label: t("highlights.holds") },
    { icon: ShieldCheck, label: t("highlights.audit") },
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel: always the dark palette (`scope-dark`), kept deliberately quiet — one soft
          gradient, no ornament. */}
      <aside className="scope-dark relative hidden overflow-hidden bg-bg text-fg lg:block">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,var(--color-accent-soft),transparent_55%)]"
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          <BrandWordmark size="lg" />

          <div className="max-w-md">
            <h2 className="text-4xl leading-[1.1] font-semibold tracking-[-0.03em] text-balance xl:text-5xl">
              {hero("titleLead")}
              <span className="block pb-[0.1em] font-serif font-normal tracking-[-0.02em] text-accent-text italic">
                {hero("titleTail")}
              </span>
            </h2>
            <p className="mt-5 text-base leading-relaxed text-fg-secondary">{t("panelBody")}</p>

            <ul className="mt-10 space-y-5">
              {highlights.map((item) => (
                <li key={item.label} className="flex items-center gap-3.5 text-sm font-medium">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-accent-soft text-accent-text"
                  >
                    <item.icon className="size-4" />
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-fg-tertiary">{BRAND.subtitle}</p>
        </div>
      </aside>

      <div className="relative flex flex-col bg-bg">
        <header className="flex items-center justify-between px-6 py-5 sm:px-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-fg-secondary transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus motion-reduce:transition-none"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("backToHome")}
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle compact />
          </div>
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-6 py-8 sm:px-10">
          <div className="w-full max-w-sm">
            <BrandWordmark size="lg" className="mb-10 block lg:hidden" />

            <h1 className="font-serif text-5xl leading-[1.05] font-normal tracking-[-0.02em] text-fg">
              {t("title")}
            </h1>
            <p className="mt-3 text-sm text-fg-secondary">{t("subtitle")}</p>

            <div className="mt-8">
              <Suspense fallback={null}>
                <LoginForm initialStep={initialStep} />
              </Suspense>
            </div>
          </div>
        </main>

        <footer className="px-6 py-5 text-center text-xs text-fg-tertiary sm:px-10">
          {BRAND.name}
        </footer>
      </div>
    </div>
  );
}
