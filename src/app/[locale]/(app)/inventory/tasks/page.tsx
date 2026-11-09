export const dynamic = "force-dynamic";

import { CalendarDays, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { STATUS } from "@/components/charts/palette";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { FilterBar } from "@/components/page/FilterBar";
import { EntityLink } from "@/components/page/EntityLink";
import { NewTaskButton, TaskRowActions } from "@/components/task/TaskDialogs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getMyTaskCounts,
  getTaskCalendar,
  getTaskFormOptions,
  listTasks,
  TASK_STATUSES,
  TASK_VIEWS,
  type TaskRow,
} from "@/features/task/queries";
import { resolveRequestLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { requirePageUser } from "@/lib/auth";
import { zonedDateKey } from "@/lib/lab-time";
import { buildListUrl, pickParam } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import { isAdminRole, isReadOnly } from "@/lib/roles";
import { env } from "@/server/env";

const BASE = "/inventory/tasks";
const DISPLAYS = ["list", "calendar"] as const;

type SearchParams = Record<string, string | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("pageTitle") };
}

/** A laboratory day key as a date the formatter prints as that same day. */
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`);

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await resolveRequestLocale(params);
  const user = await requirePageUser();
  const raw = await searchParams;
  const t = await getTranslations("tasks");
  const format = await getFormatter();

  // Administrators plan for the whole lab, so they start on everyone's tasks; a member on their own.
  const defaultView = isAdminRole(user) ? "all" : "mine";
  const view = pickParam(raw.view, TASK_VIEWS) ?? defaultView;
  const display = pickParam(raw.display, DISPLAYS) ?? "list";
  const status =
    raw.status === "all" ? undefined : (pickParam(raw.status, TASK_STATUSES) ?? "OPEN");
  const today = zonedDateKey(new Date(), env().LAB_TIMEZONE);
  const month = /^\d{4}-\d{2}$/.test(raw.month ?? "") ? raw.month! : today.slice(0, 7);
  const current = {
    view: view === defaultView ? undefined : view,
    display: display === "list" ? undefined : display,
    status: raw.status === "all" ? "all" : status === "OPEN" ? undefined : status,
    month: display === "calendar" && month !== today.slice(0, 7) ? month : undefined,
  };
  const href = (overrides: Record<string, string | undefined>) =>
    buildListUrl(BASE, current, overrides);

  const [counts, options, rows, calendar] = await Promise.all([
    getMyTaskCounts(user),
    getTaskFormOptions(user),
    display === "list" ? listTasks(user, { view, status }) : Promise.resolve([]),
    display === "calendar" ? getTaskCalendar(user, month, view) : Promise.resolve(null),
  ]);
  const canPlan = !isReadOnly(user);

  const statusBadge = (task: TaskRow) =>
    task.overdue ? (
      <Badge tone="danger">{t("overdue")}</Badge>
    ) : (
      <Badge
        tone={task.status === "DONE" ? "success" : task.status === "OPEN" ? "info" : "neutral"}
      >
        {t(`statuses.${task.status}`)}
      </Badge>
    );

  const columns: Array<Column<TaskRow>> = [
    {
      id: "due",
      header: t("columns.due"),
      cell: (task) => (
        <time
          dateTime={task.due}
          className={cn("whitespace-nowrap", task.overdue && "text-danger")}
        >
          {format.dateTime(dayDate(task.due), "date")}
        </time>
      ),
    },
    {
      id: "task",
      header: t("columns.task"),
      rowHeader: true,
      cell: (task) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">
            <span className="me-2 font-mono text-sm font-normal text-fg-secondary">
              {task.code}
            </span>
            {task.title}
          </span>
          {task.details ? (
            <span className="text-sm font-normal text-fg-secondary">{task.details}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "about",
      header: t("columns.about"),
      cell: (task) =>
        task.unit ? (
          <EntityLink kind="unit" id={task.unit.id}>
            {task.unit.name}
          </EntityLink>
        ) : task.experiment ? (
          <EntityLink kind="experiment" id={task.experiment.id}>
            {task.experiment.ecode}
          </EntityLink>
        ) : (
          <span className="text-fg-secondary">{t("wholeLab")}</span>
        ),
    },
    {
      id: "assignee",
      header: t("columns.assignee"),
      cell: (task) =>
        task.assignee ? (
          <EntityLink kind="member" id={task.assignee.id}>
            {task.assignee.name}
          </EntityLink>
        ) : (
          <span className="text-fg-secondary">{t("nobody")}</span>
        ),
    },
    { id: "status", header: t("columns.status"), cell: statusBadge },
    {
      id: "actions",
      header: t("columns.actions"),
      hideHeader: true,
      cell: (task) =>
        task.canChange ? (
          <TaskRowActions
            task={{
              id: task.id,
              title: task.title,
              due: task.due,
              status: task.status,
              assigneeId: task.assignee?.id ?? null,
            }}
            members={options.members}
          />
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={canPlan ? <NewTaskButton options={options} today={today} /> : undefined}
      />

      <StatusDonut
        title={t("cards.label")}
        slices={[
          {
            key: "overdue",
            label: t("cards.overdue.label"),
            value: counts.overdue,
            gradient: STATUS.bad,
          },
          {
            key: "today",
            label: t("cards.today.label"),
            value: counts.dueToday,
            gradient: STATUS.caution,
          },
          {
            key: "later",
            label: t("cards.later"),
            value: Math.max(counts.open - counts.overdue - counts.dueToday, 0),
            gradient: STATUS.good,
          },
        ]}
        centerValue={format.number(counts.open, "count")}
        centerLabel={t("cards.center")}
        empty={<p className="text-sm text-fg-secondary">{t("cards.none")}</p>}
      />

      <FilterBar
        controls={
          <nav aria-label={t("display.label")}>
            <ul className="flex items-center gap-6">
              {DISPLAYS.map((mode) => {
                const Icon = mode === "list" ? ListChecks : CalendarDays;
                const active = display === mode;
                return (
                  <li key={mode}>
                    <Link
                      href={href({ display: mode === "list" ? undefined : mode, month: undefined })}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-2 border-b-2 pb-1 text-sm font-medium",
                        active
                          ? "border-accent text-fg"
                          : "border-transparent text-fg-secondary hover:text-fg"
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      {t(`display.${mode}`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        }
      >
        <FilterChips
          label={t("viewLabel")}
          chips={TASK_VIEWS.map((key) => ({
            key,
            label: t(`views.${key}`),
            active: view === key,
            href: href({ view: key === defaultView ? undefined : key }),
          }))}
        />
        {display === "list" ? (
          <FilterChips
            label={t("statusLabel")}
            chips={[...TASK_STATUSES, "all" as const].map((key) => ({
              key,
              label: key === "all" ? t("allStatuses") : t(`statuses.${key}`),
              active: key === "all" ? status === undefined : status === key,
              href: href({ status: key === "OPEN" ? undefined : key }),
            }))}
          />
        ) : null}
      </FilterBar>

      {calendar ? (
        <section aria-label={t("calendar.label")}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-fg">
              {format.dateTime(dayDate(`${calendar.month}-15`), { month: "long", year: "numeric" })}
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<ChevronLeft />}
                href={href({ month: calendar.previous })}
              >
                {t("calendar.previous")}
              </Button>
              <Button variant="ghost" size="sm" href={href({ month: undefined })}>
                {t("calendar.today")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconAfter={<ChevronRight />}
                href={href({ month: calendar.next })}
              >
                {t("calendar.next")}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] table-fixed border-collapse text-sm">
              <caption className="sr-only">{t("calendar.label")}</caption>
              <thead>
                <tr>
                  {calendar.weeks[0]!.map((day) => (
                    <th
                      key={day.key}
                      scope="col"
                      className="border-b border-border py-2 text-start text-xs font-semibold text-fg-secondary"
                    >
                      {format.dateTime(dayDate(day.key), { weekday: "short" })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calendar.weeks.map((week) => (
                  <tr key={week[0]!.key}>
                    {week.map((day) => (
                      <td
                        key={day.key}
                        className={cn(
                          "h-28 border border-border p-1.5 align-top",
                          !day.inMonth && "bg-sunken text-fg-tertiary",
                          day.today && "bg-accent-soft"
                        )}
                      >
                        <time
                          dateTime={day.key}
                          className={cn(
                            "mb-1 block text-xs font-semibold",
                            day.today ? "text-accent-text" : "text-fg-secondary"
                          )}
                        >
                          {Number(day.key.slice(8))}
                          {day.today ? (
                            <span className="sr-only"> ({t("calendar.today")})</span>
                          ) : null}
                        </time>
                        <ul className="space-y-1">
                          {day.tasks.slice(0, 4).map((task) => (
                            <li
                              key={task.id}
                              title={task.title}
                              className={cn(
                                "truncate rounded px-1.5 py-0.5 text-xs",
                                task.overdue
                                  ? "bg-danger-soft text-danger"
                                  : task.status === "OPEN"
                                    ? "bg-raised text-fg ring-1 ring-border"
                                    : "text-fg-tertiary line-through"
                              )}
                            >
                              {task.experiment ? `${task.experiment.ecode} · ` : ""}
                              {task.title}
                            </li>
                          ))}
                          {day.tasks.length > 4 ? (
                            <li className="text-xs text-fg-secondary">
                              {t("calendar.more", { count: day.tasks.length - 4 })}
                            </li>
                          ) : null}
                        </ul>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <DataTable
          caption={t("caption")}
          captionHidden
          columns={columns}
          rows={rows}
          rowKey={(task) => task.id}
          empty={
            <EmptyState
              icon={<ListChecks />}
              title={t("emptyTitle")}
              description={t("emptyBody")}
              action={canPlan ? <NewTaskButton options={options} today={today} /> : undefined}
            />
          }
        />
      )}
    </div>
  );
}
