import { useFormatter, useTranslations } from "next-intl";
import { HoldBadge, SeverityBadge } from "@/components/page/domain-badges";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { ActionButton } from "@/components/unit/UnitActions";
import { Stamp, When, linkClass } from "@/components/unit/common";
import { Link } from "@/i18n/navigation";
import type {
  UnitHoldView,
  UnitIncidentView,
  UnitQuality,
  UnitSampleView,
  UnitTissueSampleView,
} from "@/features/unit/queries";

/**
 * Quality tab (lab results are set aside for now):
 * incidents, and every quality hold the unit has had with who placed and who released it.
 */
export function UnitQaPanels({ quality }: { quality: UnitQuality }) {
  return (
    <div className="space-y-6">
      {quality.samples.length > 0 ? <SamplesTable samples={quality.samples} /> : null}
      {quality.tissueSamples.length > 0 ? (
        <TissueSamplesTable samples={quality.tissueSamples} />
      ) : null}
      <IncidentsTable incidents={quality.incidents} />
      <HoldHistory holds={quality.holds} />
    </div>
  );
}

/** Samples taken from this unit: each is a unit of its own. */
function SamplesTable({ samples }: { samples: UnitSampleView[] }) {
  const t = useTranslations("units.panels.samples");
  const domain = useTranslations("domain");
  const format = useFormatter();

  const columns: Array<Column<UnitSampleView>> = [
    {
      id: "sample",
      header: t("columns.sample"),
      rowHeader: true,
      cell: (sample) => (
        <Link href={`/inventory/units/${sample.id}`} className={`${linkClass} font-medium`}>
          {sample.name}
        </Link>
      ),
    },
    { id: "kind", header: t("columns.kind"), cell: (s) => domain(`sampleKind.${s.kind}`) },
    {
      id: "amount",
      header: t("columns.amount"),
      cell: (s) =>
        s.seeds !== null
          ? t("seeds", { count: s.seeds })
          : s.dry !== null
            ? t("dry", { value: format.number(s.dry, "grams") })
            : s.wet !== null
              ? t("wet", { value: format.number(s.wet, "grams") })
              : domain("empty"),
    },
    { id: "taken", header: t("columns.taken"), cell: (s) => <When value={s.takenAt} /> },
  ];

  return (
    <Panel>
      <PanelHeader title={t("title")} description={t("description")} />
      <PanelBody>
        <DataTable caption={t("caption")} columns={columns} rows={samples} rowKey={(s) => s.id} />
      </PanelBody>
    </Panel>
  );
}

/** Tissue samples of this plant or culture, each with its code. */
function TissueSamplesTable({ samples }: { samples: UnitTissueSampleView[] }) {
  const t = useTranslations("units.panels.tissue");
  const domain = useTranslations("domain");

  const columns: Array<Column<UnitTissueSampleView>> = [
    {
      id: "code",
      header: t("columns.code"),
      rowHeader: true,
      cell: (s) => <span className="font-mono font-medium">{s.code}</span>,
    },
    {
      id: "purpose",
      header: t("columns.purpose"),
      cell: (s) => (
        <span className="flex flex-col">
          <span>{domain(`tissuePurpose.${s.purpose}`)}</span>
          <span className="text-fg-secondary">{domain(`tissueKind.${s.tissue}`)}</span>
        </span>
      ),
    },
    {
      id: "taken",
      header: t("columns.taken"),
      cell: (s) => <Stamp who={s.takenBy} whoId={s.takenById} at={s.takenAt} />,
    },
  ];

  return (
    <Panel>
      <PanelHeader title={t("title")} description={t("description")} />
      <PanelBody>
        <DataTable caption={t("caption")} columns={columns} rows={samples} rowKey={(s) => s.id} />
      </PanelBody>
    </Panel>
  );
}

function IncidentsTable({ incidents }: { incidents: UnitIncidentView[] }) {
  const t = useTranslations("units.panels.incidents");
  const domain = useTranslations("domain");

  const columns: Array<Column<UnitIncidentView>> = [
    {
      id: "opened",
      header: t("columns.opened"),
      rowHeader: true,
      cell: (incident) => (
        <Stamp who={incident.openedBy} whoId={incident.openedById} at={incident.openedAt} />
      ),
    },
    {
      id: "severity",
      header: t("columns.severity"),
      cell: (incident) => <SeverityBadge severity={incident.severity} />,
    },
    {
      id: "incident",
      header: t("columns.incident"),
      cell: (incident) => (
        <span className="flex max-w-prose flex-col">
          <Link href={`/quality/incidents/${incident.id}`} className={`${linkClass} font-medium`}>
            {incident.title}
          </Link>
          <span className="text-fg-secondary">{incident.description}</span>
          {incident.resolution ? (
            <span className="text-fg-secondary">
              <span className="font-medium">{t("resolution")}</span> {incident.resolution}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (incident) => (
        <span className="flex flex-col items-start gap-1">
          <Badge
            tone={incident.status === "CLOSED" ? "success" : "warning"}
            href={`/quality/incidents/${incident.id}`}
          >
            {domain(`incidentStatus.${incident.status}`)}
          </Badge>
          {incident.closedAt ? (
            <When value={incident.closedAt} className="text-fg-secondary" />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={t("description")}
        actions={<ActionButton action="reportIncident" />}
      />
      <PanelBody>
        <DataTable
          caption={t("caption")}
          captionHidden
          columns={columns}
          rows={incidents}
          rowKey={(incident) => incident.id}
          density="compact"
          empty={<p className="text-fg-secondary">{t("empty")}</p>}
        />
      </PanelBody>
    </Panel>
  );
}

function HoldHistory({ holds }: { holds: UnitHoldView[] }) {
  const t = useTranslations("units.panels.holds");
  const domain = useTranslations("domain");

  const columns: Array<Column<UnitHoldView>> = [
    {
      id: "placed",
      header: t("columns.placed"),
      rowHeader: true,
      cell: (hold) => <Stamp who={hold.placedBy} whoId={hold.placedById} at={hold.placedAt} />,
    },
    {
      id: "kind",
      header: t("columns.kind"),
      cell: (hold) => (
        <span className="flex flex-col items-start gap-1">
          <HoldBadge kind={hold.kind} />
          <span className="text-fg-secondary">{domain(`holdOrigin.${hold.origin}`)}</span>
        </span>
      ),
    },
    {
      id: "reason",
      header: t("columns.reason"),
      cell: (hold) => <span className="max-w-prose">{hold.reason}</span>,
    },
    {
      id: "released",
      header: t("columns.released"),
      cell: (hold) =>
        hold.releasedAt ? (
          <span className="flex flex-col">
            <Stamp who={hold.releasedBy} at={hold.releasedAt} />
            {hold.releaseNote ? (
              <span className="text-fg-secondary">{hold.releaseNote}</span>
            ) : null}
          </span>
        ) : (
          <Badge tone="warning">{t("active")}</Badge>
        ),
    },
  ];

  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ActionButton action="hold" />
            <ActionButton action="releaseHold" variant="primary" />
          </>
        }
      />
      <PanelBody>
        <DataTable
          caption={t("caption")}
          captionHidden
          columns={columns}
          rows={holds}
          rowKey={(hold) => hold.id}
          density="compact"
          empty={<p className="text-fg-secondary">{t("empty")}</p>}
        />
      </PanelBody>
    </Panel>
  );
}
