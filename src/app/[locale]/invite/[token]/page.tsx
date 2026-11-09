export const dynamic = "force-dynamic";

import { LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AcceptInviteForm } from "@/components/AcceptInviteForm";
import { BrandLogo } from "@/components/BrandLogo";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { getInviteLanding } from "@/features/auth/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { routing } from "@/i18n/routing";
import { BRAND } from "@/lib/brand";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "auth.invite",
  });
  return {
    title: t("pageTitle"),
    // The URL carries a credential: keep it out of search indexes and Referer headers.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  await resolveRequestLocale(params);
  const { token } = await params;
  const t = await getTranslations("auth.invite");
  const domain = await getTranslations("domain");

  const invitee = await getInviteLanding(token);

  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      <div className="absolute end-6 top-6 z-10 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle compact />
      </div>

      <main id="main" className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <BrandLogo size="lg" showSubtitle />
          </div>

          <div className="rounded-2xl border border-border bg-surface p-8 shadow-lg">
            {invitee ? (
              <>
                <h1 className="text-xl font-semibold text-fg">{t("title", { app: BRAND.name })}</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  {t.rich("intro", {
                    name: invitee.name,
                    role: domain(`role.${invitee.permissions}`),
                    strong: (chunks) => <strong className="text-fg">{chunks}</strong>,
                  })}
                </p>
                <div className="mt-6">
                  <AcceptInviteForm token={token} username={invitee.name} />
                </div>
              </>
            ) : (
              <div className="text-center">
                <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
                  <LinkIcon className="size-5" aria-hidden />
                </span>
                <h1 className="mt-4 text-xl font-semibold text-fg">{t("invalidTitle")}</h1>
                <p className="mt-2 text-sm text-fg-secondary">{t("invalidBody")}</p>
                <div className="mt-6">
                  <Button href="/login" variant="secondary">
                    {t("goToSignIn")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
