"use client";

import { Bell } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import type { NotificationRow } from "@/features/notification/queries";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { NotificationText } from "./NotificationText";

/** How often the unread count is refreshed while the page is open. */
const POLL_MS = 60_000;

/** `now` is when the feed was loaded, so the relative times ("5 minutes ago") are stable. */
type Feed = { unread: number; notifications: NotificationRow[]; now: Date };

/*
 * Usage: <NotificationBell className={iconButtonClasses} />
 * A bell with the unread count; it opens a panel with the newest notices. Opening a notice marks it
 * read and goes to its record; "See all" opens the notifications page. The count is refreshed every
 * minute while the tab is visible.
 */
export function NotificationBell({ className }: { className?: string }) {
  const t = useTranslations("notifications.bell");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as Omit<Feed, "now">;
      setFeed({
        now: new Date(),
        unread: data.unread,
        notifications: data.notifications.map((n) => ({ ...n, createdAt: new Date(n.createdAt) })),
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // The first load runs right after mount; then the count is refreshed while the tab is visible.
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  async function openNotice(n: NotificationRow) {
    if (!n.read) await sendJson("/api/notifications", { id: n.id });
    setOpen(false);
    if (n.href) router.push(n.href);
    void load();
  }

  async function markAll() {
    await sendJson("/api/notifications", { all: true });
    void load();
    router.refresh();
  }

  const unread = feed?.unread ?? 0;
  return (
    <Sheet
      side="right"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
      title={t("title")}
      trigger={
        <button
          type="button"
          className={cn("relative", className)}
          aria-label={unread ? t("labelUnread", { count: unread }) : t("label")}
          title={t("label")}
        >
          <Bell className="size-4" aria-hidden />
          {unread ? (
            <span
              aria-hidden
              className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-on-accent tabular-nums"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={markAll} disabled={!unread}>
            {t("markAll")}
          </Button>
          <Button
            href="/notifications"
            variant="secondary"
            size="sm"
            onClick={() => setOpen(false)}
          >
            {t("viewAll")}
          </Button>
        </div>
      }
    >
      {failed && !feed ? (
        <p className="text-sm text-fg-secondary">{t("loadFailed")}</p>
      ) : feed && feed.notifications.length === 0 ? (
        <p className="text-sm text-fg-secondary">{t("empty")}</p>
      ) : (
        <ul className="-mx-2 space-y-1">
          {(feed?.notifications ?? []).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void openNotice(n)}
                className="flex w-full gap-3.5 rounded-xl px-3 py-3 text-start text-sm leading-5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.read ? "bg-transparent" : "bg-accent-text ring-4 ring-accent-soft"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <NotificationText notification={n} />
                  <time
                    dateTime={n.createdAt.toISOString()}
                    className="mt-1 block text-xs text-fg-tertiary"
                  >
                    {format.relativeTime(n.createdAt, feed?.now)}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
