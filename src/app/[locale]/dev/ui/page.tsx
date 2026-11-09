import { FlaskConical, Inbox, Lock, Plus, Search, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  FilterChips,
  IconButton,
  Input,
  LockedState,
  PageHeader,
  Pagination,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  Skeleton,
  SkeletonText,
  Spinner,
  STATUSES,
  StatusBadge,
  Textarea,
  pageCountFor,
  clampPage,
  parsePage,
  parseSortOrder,
  type Column,
  type Status,
} from "@/components/ui";
import { routing } from "@/i18n/routing";
import { env } from "@/server/env";
import { Showcase } from "./Showcase";

/**
 * Developer-only component gallery. Not part of the product: it returns 404 in production.
 * Demo copy is English on purpose; the text inside the components is translated.
 */
export const metadata: Metadata = { title: "UI gallery", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  inactive: "Inactive",
  "on-hold": "On hold",
  shipped: "Shipped",
  destroyed: "Destroyed",
  voided: "Voided",
  pending: "Pending",
  "in-transit": "In transit",
  received: "Received",
  draft: "Draft",
};

type DemoUnit = { id: number; code: string; name: string; status: Status; weight: number };

const CULTIVARS = ["Northern Lights", "Blue Dream", "Sour Diesel", "Girl Scout Cookies", "OG Kush"];
const FILTER_STATUSES: Status[] = ["active", "on-hold", "shipped", "destroyed"];

const UNITS: DemoUnit[] = Array.from({ length: 130 }, (_, index) => ({
  id: index + 1,
  code: `U-${String(index + 1).padStart(4, "0")}`,
  name: `${CULTIVARS[index % CULTIVARS.length]} #${Math.floor(index / CULTIVARS.length) + 1}`,
  status: STATUSES[(index * 7) % STATUSES.length] as Status,
  weight: ((index * 37) % 500) + 12,
}));

const PAGE_SIZE = 10;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UiGalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  if (env().NODE_ENV === "production") notFound();

  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const query = await searchParams;
  const sortKey = first(query.sort);
  const order = parseSortOrder(query.order);
  const statusFilter = FILTER_STATUSES.find((status) => status === first(query.status));

  const filtered = UNITS.filter((unit) => !statusFilter || unit.status === statusFilter);
  const sorted = [...filtered].sort((a, b) => {
    const direction = order === "desc" ? -1 : 1;
    switch (sortKey) {
      case "code":
        return a.code.localeCompare(b.code) * direction;
      case "name":
        return a.name.localeCompare(b.name) * direction;
      case "status":
        return STATUS_LABEL[a.status].localeCompare(STATUS_LABEL[b.status]) * direction;
      case "weight":
        return (a.weight - b.weight) * direction;
      default:
        return 0;
    }
  });
  const page = clampPage(parsePage(query.page), pageCountFor(sorted.length, PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const next: Record<string, string | undefined> = {
      sort: sortKey,
      order: sortKey ? order : undefined,
      status: statusFilter,
      page: page > 1 ? String(page) : undefined,
      ...overrides,
    };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) search.set(key, value);
    const text = search.toString();
    return `/dev/ui${text ? `?${text}` : ""}#data-table`;
  };

  const columns: Array<Column<DemoUnit>> = [
    { id: "code", header: "Code", sortKey: "code", rowHeader: true, cell: (unit) => unit.code },
    { id: "name", header: "Cultivar", sortKey: "name", cell: (unit) => unit.name },
    {
      id: "status",
      header: "Status",
      sortKey: "status",
      cell: (unit) => <StatusBadge status={unit.status} label={STATUS_LABEL[unit.status]} />,
    },
    {
      id: "weight",
      header: "Weight (g)",
      sortKey: "weight",
      align: "end",
      cell: (unit) => unit.weight,
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      align: "end",
      cell: (unit) => (
        <Button href="/dev/ui" size="sm" variant="ghost">
          View<span className="sr-only"> {unit.code}</span>
        </Button>
      ),
    },
  ];

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Developer tools", href: "/dev/ui" }, { label: "UI gallery" }]}
          />
        }
        title="UI gallery"
        description="Every design-system primitive in every state. Development only; this page returns 404 in production."
        actions={
          <Button variant="secondary" href="/dev/ui" icon={<Search />}>
            Reset demo state
          </Button>
        }
      />

      <div className="flex flex-col gap-12">
        <Section id="g-buttons" title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={<Trash2 />}>
              Danger
            </Button>
            <Button variant="primary" icon={<Plus />}>
              With icon
            </Button>
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button href="/dev/ui" variant="secondary">
              Link button
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <IconButton label="Search" variant="secondary">
              <Search />
            </IconButton>
            <IconButton label="Delete" variant="danger" size="sm">
              <Trash2 />
            </IconButton>
            <span className="inline-flex items-center gap-2 text-sm text-fg-secondary">
              <Spinner /> Spinner
            </span>
          </div>
          <div className="max-w-sm">
            <Button variant="primary" className="w-full">
              Enregistrer les modifications et envoyer la demande de vérification au laboratoire
            </Button>
          </div>
        </Section>

        <Section id="g-fields" title="Form fields">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Strain name" hint="As printed on the supplier label" required>
              {(control) => <Input name="strain" placeholder="Northern Lights" {...control} />}
            </Field>
            <Field
              label="Batch weight (g)"
              error="Enter a weight between 0.1 and 5000 grams."
              required
            >
              {(control) => (
                <Input name="weight" inputMode="decimal" defaultValue="-3" {...control} />
              )}
            </Field>
            <Field label="Room">
              {(control) => (
                <Select name="room" defaultValue="b" {...control}>
                  <option value="a">Room A, vegetative</option>
                  <option value="b">Room B, flowering</option>
                  <option value="c">Room C, drying</option>
                </Select>
              )}
            </Field>
            <Field label="Disabled field" hint="Read-only for your role">
              {(control) => <Input disabled defaultValue="Locked value" {...control} />}
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              {(control) => <Textarea name="notes" rows={3} {...control} />}
            </Field>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Checkbox name="witnessed" label="Destruction was witnessed" />
              <Checkbox
                name="notify"
                label="Notify the quality team"
                description="Sends an email when the record is saved."
                defaultChecked
              />
              <Checkbox name="locked" label="Unavailable option" disabled />
            </div>
          </div>
        </Section>

        <Section id="g-badges" title="Badges and statuses">
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">Neutral</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <StatusBadge key={status} status={status} label={STATUS_LABEL[status]} />
            ))}
          </div>
          <div className="max-w-xs">
            <StatusBadge
              status="on-hold"
              label="En retenue en attente de l’approbation du contrôle de la qualité"
            />
          </div>
        </Section>

        <Section id="g-banners" title="Banners">
          <Banner tone="info" title="Information">
            Role status, announced politely.
          </Banner>
          <Banner tone="success" title="Success">
            Role status, announced politely.
          </Banner>
          <Banner tone="warning" title="Warning">
            Role alert: announced right away.
          </Banner>
          <Banner tone="danger" title="Error">
            Role alert: announced right away.
          </Banner>
        </Section>

        <Section id="g-panels" title="Panel, page header and breadcrumbs">
          <Panel>
            <PanelHeader
              title="Recent activity"
              description="Last 30 days"
              actions={
                <Button size="sm" variant="secondary">
                  Export
                </Button>
              }
            />
            <PanelBody>
              <p className="text-sm text-fg-secondary">Panel body content sits here.</p>
            </PanelBody>
          </Panel>
        </Section>

        <Showcase />

        <Section id="g-states" title="Loading, empty and locked states">
          <div aria-busy="true" className="flex flex-col gap-3 rounded-xl border border-border p-4">
            <Skeleton className="h-6 w-48" />
            <SkeletonText lines={3} />
          </div>
          <Panel>
            <EmptyState
              icon={<Inbox />}
              title="No units yet"
              description="Units appear here once an experiment starts producing them."
              action={
                <Button variant="primary" href="/dev/ui" icon={<FlaskConical />}>
                  New experiment
                </Button>
              }
              headingLevel={3}
            />
          </Panel>
          <LockedState
            icon={<Lock />}
            title="Reports are locked"
            body="A report needs a signed-off protocol and an assigned laboratory first."
            checklist={[
              { label: "Protocol approved", done: false },
              { label: "Laboratory assigned", done: true },
            ]}
            action={{ label: "Open protocols", href: "/dev/ui" }}
            headingLevel={3}
          />
        </Section>

        <Section id="g-table" title="Data table">
          <div id="data-table" className="flex scroll-mt-4 flex-col gap-4">
            <FilterChips
              label="Filter by status"
              clearHref={hrefWith({ status: undefined, page: undefined })}
              chips={FILTER_STATUSES.map((status) => ({
                key: status,
                label: STATUS_LABEL[status],
                count: UNITS.filter((unit) => unit.status === status).length,
                active: statusFilter === status,
                href: hrefWith({
                  status: statusFilter === status ? undefined : status,
                  page: undefined,
                }),
              }))}
            />
            <DataTable
              caption="Units in custody"
              columns={columns}
              rows={pageRows}
              rowKey={(unit) => unit.id}
              sort={{ sort: sortKey, order }}
              buildSortHref={(sort, nextOrder) =>
                hrefWith({ sort, order: nextOrder, page: undefined })
              }
              empty={
                <EmptyState
                  icon={<Inbox />}
                  title="No units match these filters"
                  headingLevel={3}
                />
              }
            />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              buildHref={(target) => hrefWith({ page: target > 1 ? String(target) : undefined })}
            />
            <DataTable
              caption="Empty compact table"
              captionHidden
              density="compact"
              columns={columns.slice(0, 3)}
              rows={[]}
              rowKey={(unit: DemoUnit) => unit.id}
            />
          </div>
        </Section>
      </div>
    </main>
  );
}
