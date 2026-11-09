import { useFormatter, useTranslations } from "next-intl";
import { EntityLink } from "@/components/page/EntityLink";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Link } from "@/i18n/navigation";
import type { OrganizationAuditRow } from "@/features/organization/queries";

/** The last changes to this organization's profile, from the audit trail (shown as recorded). */
export function ActivityPanel({ entries }: { entries: OrganizationAuditRow[] }) {
  const t = useTranslations("organizations.detail.activity");
  const format = useFormatter();
  return (
    <Panel>
      <PanelHeader title={t("title")} description={t("description")} />
      <PanelBody>
        {entries.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("none")}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <Link
                  href="/compliance/audit?entity=organization"
                  className="text-accent-text hover:underline"
                >
                  {entry.summary}
                </Link>
                <span className="text-fg-secondary">
                  <EntityLink kind="member" id={entry.userId}>
                    {t("by", { name: entry.userName })}
                  </EntityLink>{" "}
                  ·{" "}
                  <time dateTime={entry.createdAt.toISOString()}>
                    {format.dateTime(entry.createdAt, "dateTime")}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
