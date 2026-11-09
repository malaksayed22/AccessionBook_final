import { Dna } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ProportionBar } from "@/components/charts/ProportionBar";
import { STATUS } from "@/components/charts/palette";
import { CultivarLocations } from "@/components/CultivarLocations";
import { Badge } from "@/components/ui/Badge";
import type { CultivarDetails } from "@/features/cultivar/queries";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type CultivarCardData = {
  id: number;
  name: string;
  code: string | null;
  commonName: string | null;
  category: string | null;
  targetThc: number | null;
  targetCbd: number | null;
  comment: string | null;
  stats: {
    totalUnits: number;
    activeUnits: number;
    onHold: number;
    experiments: number;
    locations: number;
  };
  details: CultivarDetails;
};

/*
 * Usage: <ul><li><CultivarCard cultivar={row} /></li></ul>
 * One cultivar of the genetic library: its names and category, the dates, target potency and what is
 * in inventory, three bars (units by status, by kind of material, plants by growth stage) with every
 * figure printed in their legends, and the places it is stored (each opens a summary of that place).
 * The whole card opens the full record: the name link is stretched over the card, and the location
 * buttons sit above it. Server-friendly: only the location buttons are client code.
 */
export function CultivarCard({
  cultivar,
  className,
}: {
  cultivar: CultivarCardData;
  className?: string;
}) {
  const t = useTranslations("cultivars.card");
  const domain = useTranslations("domain");
  const format = useFormatter();
  const potency = (value: number | null) =>
    value === null ? domain("empty") : format.number(value / 100, "percent");
  const day = (date: Date | null) => (date ? format.dateTime(date, "date") : domain("empty"));
  const { stats, details } = cultivar;
  const href = `/records/cultivars/${cultivar.id}`;

  return (
    <article
      className={cn(
        "relative row-span-7 grid h-full grid-rows-subgrid gap-y-0 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors duration-150 hover:border-border-strong hover:bg-hover motion-reduce:transition-none has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus",
        className
      )}
    >
      <div className="row-start-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg wrap-break-word">
            <Link
              href={href}
              className="flex items-center gap-2 outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              <Dna aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
              {cultivar.name}
            </Link>
          </h3>
          {cultivar.code || cultivar.commonName ? (
            <p className="mt-0.5 text-sm text-fg-secondary wrap-break-word">
              {[cultivar.code, cultivar.commonName].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        {cultivar.category ? <Badge tone="neutral">{cultivar.category}</Badge> : null}
      </div>

      <dl className="row-start-2 grid grid-cols-2 content-start gap-x-4 gap-y-2 pt-4 text-sm">
        <Fact label={t("targetThc")}>{potency(cultivar.targetThc)}</Fact>
        <Fact label={t("targetCbd")}>{potency(cultivar.targetCbd)}</Fact>
        <Fact label={t("inInventory")}>
          {t("inventoryOf", { active: stats.activeUnits, total: stats.totalUnits })}
        </Fact>
        <Fact label={t("experiments")}>{format.number(stats.experiments, "count")}</Fact>
        <Fact label={t("created")}>{day(details.createdAt)}</Fact>
        <Fact label={t("lastActivity")}>{day(details.lastActivity)}</Fact>
      </dl>

      <div className="relative z-10 row-start-3 self-start pt-4">
        <p className="mb-1.5 text-sm text-fg-secondary">{t("locations")}</p>
        {details.locations.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("noLocations")}</p>
        ) : (
          <CultivarLocations cultivarId={cultivar.id} places={details.locations} />
        )}
      </div>

      {stats.totalUnits === 0 ? (
        <p className="row-start-4 pt-4 text-sm text-fg-secondary">{t("noUnits")}</p>
      ) : (
        <div className="row-span-3 row-start-4 grid grid-rows-subgrid gap-y-0 space-y-0">
          {details.stages.length > 0 ? (
            <div className="row-start-1 pt-4">
              <p className="mb-1.5 text-sm font-medium text-fg">{t("bars.stages")}</p>
              <ProportionBar
                label={t("bars.stages")}
                segments={details.stages.map(({ stage, count }) => ({
                  key: stage,
                  label: domain(`growthStage.${stage as "VEGETATIVE"}`),
                  value: count,
                }))}
              />
            </div>
          ) : null}
          <div className="row-start-2 pt-4">
            <p className="mb-1.5 text-sm font-medium text-fg">{t("bars.statuses")}</p>
            <ProportionBar
              label={t("bars.statuses")}
              segments={[
                {
                  key: "active",
                  label: domain("unitStatus.active"),
                  value: details.statuses.active,
                  gradient: STATUS.good,
                },
                {
                  key: "on-hold",
                  label: domain("unitStatus.on-hold"),
                  value: details.statuses.onHold,
                  gradient: STATUS.caution,
                },
                {
                  key: "inactive",
                  label: domain("unitStatus.nothingLeft"),
                  value: details.statuses.inactive,
                  gradient: STATUS.neutral,
                },
                {
                  key: "destroyed",
                  label: domain("unitStatus.destroyed"),
                  value: details.statuses.destroyed,
                  gradient: STATUS.bad,
                },
              ]}
            />
          </div>
          <div className="row-start-3 pt-4">
            <p className="mb-1.5 text-sm font-medium text-fg">{t("bars.types")}</p>
            <ProportionBar
              label={t("bars.types")}
              segments={details.types.map(({ type, count }) => ({
                key: type,
                label: domain(`unitTypePlural.${type}`),
                value: count,
              }))}
            />
          </div>
        </div>
      )}

      <p className="row-start-7 line-clamp-2 pt-4 text-sm text-fg-secondary">
        {cultivar.comment || t("noNotes")}
      </p>
    </article>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}
