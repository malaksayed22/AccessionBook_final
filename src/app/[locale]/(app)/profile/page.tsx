export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { UrlTabs } from "@/components/page/UrlTabs";
import { AccountForm } from "@/components/profile/AccountForm";
import { PasswordForm } from "@/components/profile/PasswordForm";
import { ProfileSummary } from "@/components/profile/ProfileSummary";
import { SessionsPanel } from "@/components/profile/SessionsPanel";
import { TwoStepPanel } from "@/components/profile/TwoStepPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { getProfileSummary } from "@/features/auth/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { getSession, requirePageUser } from "@/lib/auth";
import { normalizeCodePrefix } from "@/lib/experiment-codes";
import { pickParam } from "@/lib/list-params";
import { env } from "@/server/env";
import { listActiveSessions } from "@/server/session";

const TABS = ["general", "security", "sessions"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("pageTitle") };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const t = await getTranslations("profile");
  const tab = pickParam((await searchParams).tab, TABS) ?? "general";

  const [summary, session, sessions] = await Promise.all([
    getProfileSummary(user.id),
    getSession(),
    listActiveSessions(user.id),
  ]);
  const prefix = normalizeCodePrefix(summary.initials, user.name);
  const isAdmin = user.permissions === "ADMIN";
  const now = new Date();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="flex flex-col gap-6">
        <ProfileSummary
          name={user.name}
          isAdmin={isAdmin}
          role={user.permissions}
          email={summary.email}
          prefix={prefix}
          createdAt={summary.createdAt}
          lastLoginAt={summary.lastLoginAt}
          passwordChangedAt={summary.passwordChangedAt}
          mfaEnabled={summary.mfaEnabled}
        />
        <UrlTabs
          className="[&_[role=tablist]]:pb-px [&_[role=tablist]]:[scrollbar-width:none] [&_[role=tablist]]:overflow-y-hidden [&_[role=tablist]::-webkit-scrollbar]:hidden"
          label={t("tabs.label")}
          initial={tab}
          defaultId="general"
          tabs={TABS.map((id) => ({ id, label: t(`tabs.${id}`) }))}
          panels={{
            general: <AccountForm currentName={user.name} currentInitials={prefix} />,
            security: (
              <div className="space-y-6">
                <PasswordForm />
                <TwoStepPanel
                  enabled={summary.mfaEnabled}
                  required={isAdmin && env().REQUIRE_ADMIN_MFA}
                  recoveryCodesLeft={summary.recoveryCodesLeft}
                />
              </div>
            ),
            sessions: (
              <SessionsPanel
                nowIso={now.toISOString()}
                sessions={sessions.map((s) => ({
                  id: s.id,
                  lastSeenAt: s.lastSeenAt.toISOString(),
                  ip: s.ip,
                  userAgent: s.userAgent,
                  current: s.id === session?.id,
                }))}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
