"use client";

import { Laptop } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";
import { describeUserAgent } from "@/lib/user-agent";

export type SessionRow = {
  id: number;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

/** Devices signed in to the account, with the means to end any of them. */
export function SessionsPanel({ sessions, nowIso }: { sessions: SessionRow[]; nowIso: string }) {
  const t = useTranslations("profile.sessions");
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const describe = useApiError();
  const networkMessage = useNetworkError();
  const [busy, setBusy] = useState<number | "others" | null>(null);

  const now = new Date(nowIso);
  const others = sessions.filter((s) => !s.current);

  async function end(id: number) {
    setBusy(id);
    const result = await sendJson(`/api/auth/sessions/${id}`, undefined, "DELETE");
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "danger", title: result.network ? networkMessage : describe(result.error) });
      return;
    }
    toast({ tone: "success", title: t("endDone") });
    router.refresh();
  }

  async function endOthers() {
    setBusy("others");
    const result = await sendJson<{ ended: number }>("/api/auth/sessions", undefined, "DELETE");
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "danger", title: result.network ? networkMessage : describe(result.error) });
      return;
    }
    toast({ tone: "success", title: t("endOthersDone", { count: result.data.ended }) });
    router.refresh();
  }

  return (
    <Panel className="overflow-hidden before:hidden">
      <PanelHeader
        title={t("title")}
        description={t("description")}
        className="bg-none"
        actions={
          others.length > 0 ? (
            <Button variant="secondary" size="sm" loading={busy === "others"} onClick={endOthers}>
              {t("endOthers")}
            </Button>
          ) : null
        }
      />
      <ul aria-label={t("list")} className="divide-y divide-border">
        {sessions.map((session) => {
          const { browser, system } = describeUserAgent(session.userAgent);
          const device =
            browser && system
              ? t("browserOn", { browser, system })
              : (browser ?? system ?? t("unknownDevice"));
          return (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-hover/50 sm:px-6"
            >
              <Laptop
                aria-hidden
                className="size-10 shrink-0 rounded-xl border border-border bg-sunken p-2.5 text-fg-secondary"
              />
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                  <span className="wrap-break-word">{device}</span>
                  {session.current ? <Badge tone="accent">{t("thisDevice")}</Badge> : null}
                </p>
                <p className="mt-0.5 text-sm text-fg-secondary">
                  {session.ip ?? t("unknownAddress")} ·{" "}
                  {t("lastActive", {
                    when: format.relativeTime(new Date(session.lastSeenAt), now),
                  })}
                </p>
              </div>
              {session.current ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === session.id}
                  onClick={() => end(session.id)}
                >
                  {t("end")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {others.length === 0 ? (
        <PanelBody className="border-t border-border text-sm text-fg-secondary">
          {t("onlyThis")}
        </PanelBody>
      ) : null}
    </Panel>
  );
}
