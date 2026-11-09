export const dynamic = "force-dynamic";

import {
  Building2,
  Dna,
  FlaskConical,
  Microscope,
  Search as SearchIcon,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { EntityLink } from "@/components/page/EntityLink";
import { SearchForm } from "@/components/page/SearchForm";
import { UnitStatusBadge, UnitTypeBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import {
  normalizeSearchText,
  SEARCH_MIN_LENGTH,
  searchAll,
  type SearchGroup,
} from "@/features/search/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isAdmin, requirePageUser } from "@/lib/auth";

const BASE = "/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("search");
  return { title: t("pageTitle") };
}

const rowLink =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("search");
  const domain = await getTranslations("domain");
  const format = await getFormatter();

  const admin = isAdmin(user);
  const typed = raw.q?.trim() ?? "";
  const needle = normalizeSearchText(raw.q);
  const results = needle ? await searchAll(user, needle) : null;

  const groups = results
    ? [
        results.units.total,
        results.experiments.total,
        results.cultivars.total,
        results.organizations?.total ?? 0,
        results.members?.total ?? 0,
      ]
    : [];
  const totalHits = groups.reduce((sum, n) => sum + n, 0);

  const countLabel = (group: SearchGroup<unknown>) =>
    t("groupCount", {
      shown: format.number(group.hits.length, "count"),
      total: format.number(group.total, "count"),
    });

  const heading = (icon: ReactNode, title: string, group: SearchGroup<unknown>) => (
    <PanelHeader
      title={
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-flex text-fg-secondary [&>svg]:size-4">
            {icon}
          </span>
          {title}
        </span>
      }
      description={countLabel(group)}
    />
  );

  const showAll = (group: SearchGroup<unknown>, label: string, href: string) =>
    group.total > group.hits.length ? (
      <p className="border-t border-border px-4 py-3 text-sm sm:px-5">
        <Link href={href} className="font-medium text-accent-text hover:underline">
          {label}
        </Link>
      </p>
    ) : null;

  const encoded = encodeURIComponent(needle ?? "");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t("title")}
        description={admin ? t("descriptionAdmin") : t("description")}
        className="pb-0"
      />

      <SearchForm
        action={BASE}
        params={{}}
        q={typed}
        label={t("label")}
        placeholder={t("placeholder")}
      />

      {!results ? (
        <Panel>
          <EmptyState
            icon={<SearchIcon />}
            title={typed ? t("tooShortTitle") : t("startTitle")}
            description={
              typed
                ? t("tooShortBody", { min: SEARCH_MIN_LENGTH })
                : t("startBody", { min: SEARCH_MIN_LENGTH })
            }
          />
          <p className="px-4 pb-6 text-center text-sm text-fg-secondary">{t("tip")}</p>
        </Panel>
      ) : totalHits === 0 ? (
        <Panel>
          <EmptyState
            icon={<SearchIcon />}
            title={t("noResultsTitle", { query: results.query })}
            description={t("noResultsBody")}
            action={
              <Button href={BASE} variant="secondary">
                {t("startTitle")}
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <p className="text-sm text-fg-secondary" role="status">
            {t("summary", { count: totalHits, query: results.query })}
          </p>

          {results.units.total > 0 ? (
            <Panel>
              {heading(<Microscope />, t("groups.units"), results.units)}
              <ul className="divide-y divide-border">
                {results.units.hits.map((unit) => (
                  <li key={unit.id} className={`relative ${rowLink}`}>
                    {/* The name's link covers the whole row; the badges and names beside it sit above
                        that cover so each can be a link of its own. */}
                    <Link
                      href={`/inventory/units/${unit.id}`}
                      className="font-medium text-accent-text after:absolute after:inset-0 hover:underline"
                    >
                      {unit.name}
                    </Link>
                    <span className="relative z-10 flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
                      <UnitTypeBadge type={unit.type} />
                      <UnitStatusBadge status={unit.status} />
                      {unit.cultivarName ? (
                        <EntityLink kind="cultivar" id={unit.cultivarId} className="font-normal">
                          {unit.cultivarName}
                        </EntityLink>
                      ) : null}
                      {unit.experimentCode ? (
                        <EntityLink
                          kind="experiment"
                          id={unit.experimentId}
                          className="font-normal"
                        >
                          {unit.experimentCode}
                        </EntityLink>
                      ) : null}
                      {unit.locationName ? (
                        <EntityLink kind="location" id={unit.locationId} className="font-normal">
                          {unit.locationName}
                        </EntityLink>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {showAll(
                results.units,
                t("showAll.units", { count: results.units.total }),
                `/inventory/units?q=${encoded}`
              )}
            </Panel>
          ) : null}

          {results.experiments.total > 0 ? (
            <Panel>
              {heading(<FlaskConical />, t("groups.experiments"), results.experiments)}
              <ul className="divide-y divide-border">
                {results.experiments.hits.map((experiment) => (
                  <li key={experiment.id}>
                    <Link href={`/inventory/experiments/${experiment.id}`} className={rowLink}>
                      <span>
                        <span className="font-mono font-medium text-accent-text">
                          {experiment.ecode}
                        </span>{" "}
                        {experiment.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {showAll(
                results.experiments,
                t("showAll.experiments", { count: results.experiments.total }),
                `/inventory/experiments?q=${encoded}`
              )}
            </Panel>
          ) : null}

          {results.cultivars.total > 0 ? (
            <Panel>
              {heading(<Dna />, t("groups.cultivars"), results.cultivars)}
              <ul className="divide-y divide-border">
                {results.cultivars.hits.map((cultivar) => (
                  <li key={cultivar.id}>
                    <Link href={`/records/cultivars/${cultivar.id}`} className={rowLink}>
                      <span className="font-medium text-accent-text">{cultivar.name}</span>
                      <span className="text-sm text-fg-secondary">
                        {[cultivar.code, cultivar.commonName].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {showAll(
                results.cultivars,
                t("showAll.cultivars", { count: results.cultivars.total }),
                `/records/cultivars?q=${encoded}`
              )}
            </Panel>
          ) : null}

          {results.organizations && results.organizations.total > 0 ? (
            <Panel>
              {heading(<Building2 />, t("groups.organizations"), results.organizations)}
              <ul className="divide-y divide-border">
                {results.organizations.hits.map((organization) => (
                  <li key={organization.id}>
                    <Link href={`/records/organizations/${organization.id}`} className={rowLink}>
                      <span className="font-medium text-accent-text">{organization.name}</span>
                      <span className="text-sm text-fg-secondary">
                        {[organization.country, organization.licenceNumber]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {showAll(
                results.organizations,
                t("showAll.organizations", { count: results.organizations.total }),
                `/records/organizations?q=${encoded}`
              )}
            </Panel>
          ) : null}

          {results.members && results.members.total > 0 ? (
            <Panel>
              {heading(<Users />, t("groups.members"), results.members)}
              <ul className="divide-y divide-border">
                {results.members.hits.map((member) => (
                  <li key={member.id}>
                    <Link href={`/records/members/${member.id}`} className={rowLink}>
                      <span className="font-medium text-accent-text">{member.name}</span>
                      <span className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
                        <Badge tone="neutral">{domain(`role.${member.permissions}`)}</Badge>
                        {member.active ? null : (
                          <Badge tone="neutral">{domain("memberStatus.deactivated")}</Badge>
                        )}
                        {member.email}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {showAll(
                results.members,
                t("showAll.members", { count: results.members.total }),
                `/records/members?q=${encoded}`
              )}
            </Panel>
          ) : null}

          {admin ? null : <p className="text-sm text-fg-secondary">{t("adminOnlyNote")}</p>}
        </>
      )}
    </div>
  );
}
