export const dynamic = "force-dynamic";

import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { NotificationLink } from "@/components/notifications/NotificationLink";
import { NotificationText } from "@/components/notifications/NotificationText";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { listNotifications } from "@/features/notification/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { requirePageUser } from "@/lib/auth";
import { buildListUrl, parseListParams } from "@/lib/list-params";
import { isAdminRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

const BASE = "/notifications";
const PAGE_SIZE = 25;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.page");
  return { title: t("pageTitle") };
}

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("notifications.page");
  const format = await getFormatter();
  const unreadOnly = raw.show === "unread";
  const list = parseListParams(raw, { sort: "date", order: "desc" });

  const { rows, total, unread } = await listNotifications(user, {
    page: list.page,
    limit: PAGE_SIZE,
    unread: unreadOnly,
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("title")}
        description={isAdminRole(user) ? t("descriptionAdmin") : t("descriptionMember")}
        actions={<MarkAllReadButton label={t("markAll")} disabled={unread === 0} />}
      />

      <FilterChips
        className="mb-5 inline-flex rounded-lg border border-border bg-surface px-3 shadow-xs [&_button]:after:hidden"
        chips={[
          { key: "all", label: t("all"), active: !unreadOnly, href: BASE },
          {
            key: "unread",
            label: `${t("unreadOnly")} (${format.number(unread, "count")})`,
            active: unreadOnly,
            href: buildListUrl(BASE, { show: "unread" }),
          },
        ]}
      />

      <Panel className="overflow-hidden before:hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title={unreadOnly ? t("emptyUnreadTitle") : t("emptyTitle")}
            description={unreadOnly ? t("emptyUnreadBody") : t("emptyBody")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "relative",
                  n.read
                    ? ""
                    : "bg-accent-soft/40 font-medium before:absolute before:inset-y-0 before:start-0 before:w-1 before:bg-accent-text [&_.line-clamp-2]:font-normal"
                )}
              >
                <NotificationLink id={n.id} href={n.href} read={n.read}>
                  <span
                    className={cn(
                      "relative mt-px flex size-8 shrink-0 items-center justify-center rounded-full border after:size-2 after:rounded-full",
                      n.read
                        ? "border-border bg-sunken after:bg-fg-tertiary/40"
                        : "border-accent-soft-border bg-accent-soft after:bg-accent-text"
                    )}
                  >
                    {n.read ? null : <span className="sr-only">{t("unread")}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <NotificationText notification={n} />
                  </span>
                  <time
                    dateTime={n.createdAt.toISOString()}
                    className="shrink-0 pt-0.5 text-xs font-normal text-fg-tertiary tabular-nums"
                  >
                    {format.dateTime(n.createdAt, "dateTime")}
                  </time>
                </NotificationLink>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Pagination
        className="mt-4"
        page={list.page}
        pageSize={PAGE_SIZE}
        total={total}
        buildHref={(page) =>
          buildListUrl(BASE, { show: unreadOnly ? "unread" : undefined }, { page })
        }
      />
    </div>
  );
}
