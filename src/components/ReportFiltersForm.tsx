import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/FormControls";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { AUDIT_ACTION_VALUES, AUDIT_ENTITY_VALUES, UNIT_TYPE_VALUES } from "@/lib/reports/filters";
import type { ReportFilters, ReportMeta } from "@/lib/reports/types";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const STATUS_VALUES = ["all", "active", "completed"] as const;

/*
 * Usage (server component): <ReportFiltersForm report={meta} defaults={filters} options={options} zone="America/Toronto" />
 * A plain GET form: the filters become the URL, so a report can be bookmarked, shared and
 * exported with exactly what is on screen. Works without JavaScript. Only the controls the report
 * offers are shown. Dates are calendar days in the laboratory time zone.
 */
export function ReportFiltersForm({
  report,
  defaults,
  options,
  zone,
}: {
  report: ReportMeta;
  defaults: ReportFilters;
  options: {
    locations: Array<{ id: number; name: string }>;
    experiments: Array<{ id: number; ecode: string; name: string }>;
  };
  zone: string;
}) {
  const t = useTranslations("reports.filters");
  const domain = useTranslations("domain");
  const locale = useLocale();
  const has = (key: ReportMeta["filters"][number]) => report.filters.includes(key);
  const action = `/${locale}/compliance/reports/${report.id}`;

  return (
    <Panel className="print:hidden">
      <PanelBody>
        <form method="get" action={action} aria-label={t("heading")} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {has("month") ? (
              <>
                <Field label={t("year")}>
                  {(control) => (
                    <Input
                      name="year"
                      type="number"
                      min={2000}
                      max={2100}
                      defaultValue={defaults.year}
                      {...control}
                    />
                  )}
                </Field>
                <Field label={t("month")}>
                  {(control) => (
                    <Select name="month" defaultValue={defaults.month} {...control}>
                      {MONTHS.map((month) => (
                        <option key={month} value={month}>
                          {t(`months.${month}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </>
            ) : null}

            {has("license") ? (
              <Field label={t("licence")}>
                {(control) => (
                  <Input
                    name="licenseId"
                    maxLength={60}
                    placeholder={t("licencePlaceholder")}
                    defaultValue={defaults.licenseId}
                    {...control}
                  />
                )}
              </Field>
            ) : null}

            {has("dateRange") ? (
              <>
                <Field label={t("from")}>
                  {(control) => (
                    <Input name="from" type="date" defaultValue={defaults.from} {...control} />
                  )}
                </Field>
                <Field label={t("to")}>
                  {(control) => (
                    <Input name="to" type="date" defaultValue={defaults.to} {...control} />
                  )}
                </Field>
              </>
            ) : null}

            {has("asOf") ? (
              <Field label={t("asOf")}>
                {(control) => (
                  <Input name="asOf" type="date" defaultValue={defaults.asOf} {...control} />
                )}
              </Field>
            ) : null}

            {has("experiment") ? (
              <Field label={t("experiment")}>
                {(control) => (
                  <Select
                    name="experimentId"
                    defaultValue={defaults.experimentId ?? ""}
                    {...control}
                  >
                    <option value="">{t("allExperiments")}</option>
                    {options.experiments.map((experiment) => (
                      <option key={experiment.id} value={experiment.id}>
                        {experiment.ecode} · {experiment.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {has("unitType") ? (
              <Field label={t("unitType")}>
                {(control) => (
                  <Select name="unitType" defaultValue={defaults.unitType ?? ""} {...control}>
                    <option value="">{t("allTypes")}</option>
                    {UNIT_TYPE_VALUES.map((type) => (
                      <option key={type} value={type}>
                        {domain(`unitType.${type}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {has("location") ? (
              <Field label={t("location")}>
                {(control) => (
                  <Select name="locationId" defaultValue={defaults.locationId ?? ""} {...control}>
                    <option value="">{t("allLocations")}</option>
                    {options.locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {has("status") ? (
              <Field label={t("status")}>
                {(control) => (
                  <Select name="status" defaultValue={defaults.status ?? "all"} {...control}>
                    {STATUS_VALUES.map((status) => (
                      <option key={status} value={status}>
                        {t(`statusOptions.${status}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {has("audit") ? (
              <>
                <Field label={t("entity")}>
                  {(control) => (
                    <Select
                      name="entityType"
                      defaultValue={defaults.entityType ?? "all"}
                      {...control}
                    >
                      {AUDIT_ENTITY_VALUES.map((entity) => (
                        <option key={entity} value={entity}>
                          {t(`entityOptions.${entity}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t("action")}>
                  {(control) => (
                    <Select name="action" defaultValue={defaults.action ?? "all"} {...control}>
                      {AUDIT_ACTION_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {t(`actionOptions.${value}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary">
              {t("generate")}
            </Button>
            <Button href={`/compliance/reports/${report.id}`} variant="ghost">
              {t("reset")}
            </Button>
            {has("month") || has("dateRange") || has("asOf") ? (
              <p className="text-sm text-fg-secondary">{t("zoneNote", { zone })}</p>
            ) : null}
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
