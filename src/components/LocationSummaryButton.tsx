"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ProportionBar } from "@/components/charts/ProportionBar";
import { STATUS } from "@/components/charts/palette";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import type { ApiErrorBody } from "@/lib/api-error";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { Link } from "@/i18n/navigation";
import type { LocationSummary } from "@/features/location/queries";

type Load =
  | { state: "loading" }
  | { state: "done"; summary: LocationSummary }
  | { state: "failed"; message: string };

/**
 * A location as a button: clicking it opens a summary of the place (what is stored there now, how full
 * it is, which experiments use it) and, when `cultivarId` is given, how much of it is that cultivar.
 * The figures are read when the summary opens, so they are always the current ones.
 */
export function LocationSummaryButton({
  locationId,
  name,
  count,
  cultivarId,
}: {
  locationId: number;
  name: string;
  /** Units of the cultivar here, shown on the chip. */
  count?: number;
  cultivarId?: number;
}) {
  const t = useTranslations("cultivars.locationSummary");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-sunken px-2.5 py-1 text-sm text-accent-text transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none"
        aria-haspopup="dialog"
      >
        <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{name}</span>
        {count !== undefined ? (
          <span className="font-semibold text-fg tabular-nums">{count}</span>
        ) : null}
        <span className="sr-only">{t("open")}</span>
      </button>
      {open ? (
        <SummaryDialog
          locationId={locationId}
          name={name}
          cultivarId={cultivarId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function SummaryDialog({
  locationId,
  name,
  cultivarId,
  onClose,
}: {
  locationId: number;
  name: string;
  cultivarId?: number;
  onClose: () => void;
}) {
  const t = useTranslations("cultivars.locationSummary");
  const domain = useTranslations("domain");
  const apiError = useApiError();
  const networkError = useNetworkError();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const query = cultivarId !== undefined ? `?cultivarId=${cultivarId}` : "";
    (async () => {
      try {
        const response = await fetch(`/api/locations/${locationId}/summary${query}`, {
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as
          { summary?: LocationSummary } | ApiErrorBody | null;
        if (response.ok && body && "summary" in body && body.summary) {
          setLoad({ state: "done", summary: body.summary });
        } else {
          setLoad({ state: "failed", message: apiError(body as ApiErrorBody | null) });
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setLoad({ state: "failed", message: networkError });
      }
    })();
    return () => controller.abort();
  }, [locationId, cultivarId, apiError, networkError]);

  const summary = load.state === "done" ? load.summary : null;
  const types = (list: Array<{ type: string; count: number }>) =>
    list.map(({ type, count }) => ({
      key: type,
      label: domain(`unitTypePlural.${type as "PLANT"}`),
      value: count,
    }));
  const states = (active: number, onHold: number) => [
    { key: "active", label: domain("unitStatus.active"), value: active, gradient: STATUS.good },
    {
      key: "on-hold",
      label: domain("unitStatus.on-hold"),
      value: onHold,
      gradient: STATUS.caution,
    },
  ];

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={name}
      description={summary?.address ?? t("description")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("close")}
          </Button>
          <Button href={`/inventory/units?location=${locationId}`} variant="primary">
            {t("viewUnits")}
          </Button>
        </>
      }
    >
      {load.state === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-fg-secondary" role="status">
          <Spinner /> {t("loading")}
        </p>
      ) : null}
      {load.state === "failed" ? <Banner tone="danger">{load.message}</Banner> : null}
      {summary ? (
        <div className="space-y-5">
          {!summary.active ? <Banner tone="info">{t("retired")}</Banner> : null}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-fg-secondary">{t("inside")}</dt>
              <dd className="font-medium tabular-nums">{summary.occupancy}</dd>
            </div>
            <div>
              <dt className="text-fg-secondary">{t("capacity")}</dt>
              <dd className="font-medium tabular-nums">
                {summary.capacity === null
                  ? t("noLimit")
                  : t("used", { occupancy: summary.occupancy, capacity: summary.capacity })}
              </dd>
            </div>
          </dl>

          {summary.cultivar ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-fg">
                {t("ofCultivar", { name: summary.cultivar.name })}
              </h3>
              {summary.cultivar.active + summary.cultivar.onHold === 0 ? (
                <p className="text-sm text-fg-secondary">{t("noneOfCultivar")}</p>
              ) : (
                <>
                  <ProportionBar
                    label={t("status")}
                    segments={states(summary.cultivar.active, summary.cultivar.onHold)}
                  />
                  <ProportionBar label={t("types")} segments={types(summary.cultivar.types)} />
                  {summary.cultivar.stages.length > 0 ? (
                    <ProportionBar
                      label={t("stages")}
                      segments={summary.cultivar.stages.map(({ stage, count }) => ({
                        key: stage,
                        label: domain(`growthStage.${stage as "VEGETATIVE"}`),
                        value: count,
                      }))}
                    />
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">{t("everything")}</h3>
            {summary.occupancy === 0 ? (
              <p className="text-sm text-fg-secondary">{t("empty")}</p>
            ) : (
              <>
                <ProportionBar
                  label={t("status")}
                  segments={states(summary.here.active, summary.here.onHold)}
                />
                <ProportionBar label={t("types")} segments={types(summary.here.types)} />
              </>
            )}
          </section>

          {summary.experiments.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-fg">{t("experiments")}</h3>
              <ul className="space-y-1 text-sm">
                {summary.experiments.map((experiment) => (
                  <li key={experiment.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/inventory/experiments/${experiment.id}`}
                      className="min-w-0 truncate text-accent-text hover:underline"
                    >
                      {experiment.ecode} · {experiment.name}
                    </Link>
                    <span className="shrink-0 font-semibold tabular-nums">{experiment.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
