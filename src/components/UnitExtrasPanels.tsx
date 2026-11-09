import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { ActionButton } from "@/components/unit/UnitActions";
import { Stamp, linkClass } from "@/components/unit/common";
import type { UnitAttachmentView, UnitDocuments } from "@/features/unit/queries";

/** The number of hash characters shown; the full SHA-256 is in the audit report. */
const HASH_PREVIEW = 12;

/**
 * Documents and activity tab. A document's SHA-256 is recorded at upload so its integrity can be
 * checked later; removing one voids it with a reason and keeps the file as evidence.
 */
export function UnitExtrasPanels({
  unitId,
  documents,
}: {
  unitId: number;
  documents: UnitDocuments;
}) {
  return (
    <div className="space-y-6">
      <AttachmentsTable unitId={unitId} attachments={documents.attachments} />
    </div>
  );
}

function AttachmentsTable({
  unitId,
  attachments,
}: {
  unitId: number;
  attachments: UnitAttachmentView[];
}) {
  const t = useTranslations("units.panels.documents");
  const domain = useTranslations("domain");
  const format = useFormatter();

  const size = (bytes: number | null) => {
    if (bytes === null) return domain("empty");
    return bytes >= 1024 * 1024
      ? format.number(bytes / (1024 * 1024), {
          style: "unit",
          unit: "megabyte",
          maximumFractionDigits: 1,
        })
      : format.number(bytes / 1024, { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 });
  };

  const columns: Array<Column<UnitAttachmentView>> = [
    {
      id: "document",
      header: t("columns.document"),
      rowHeader: true,
      cell: (a) => (
        <span className="flex flex-col">
          <a href={`/api/units/${unitId}/attachments/${a.id}`} className={linkClass} download>
            {a.label}
          </a>
          <span className="text-fg-secondary">{a.fileName}</span>
        </span>
      ),
    },
    {
      id: "category",
      header: t("columns.category"),
      cell: (a) => <Badge>{domain(`attachmentCategory.${a.category}`)}</Badge>,
    },
    { id: "size", header: t("columns.size"), cell: (a) => size(a.sizeBytes) },
    {
      id: "hash",
      header: t("columns.checksum"),
      cell: (a) =>
        a.sha256 ? (
          <code className="text-xs" title={a.sha256}>
            {a.sha256.slice(0, HASH_PREVIEW)}
          </code>
        ) : (
          domain("empty")
        ),
    },
    {
      id: "added",
      header: t("columns.added"),
      cell: (a) => <Stamp who={a.uploadedBy} whoId={a.uploadedById} at={a.uploadedAt} />,
    },
  ];

  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={t("description")}
        actions={<ActionButton action="upload" />}
      />
      <PanelBody>
        <DataTable
          caption={t("caption")}
          captionHidden
          columns={columns}
          rows={attachments}
          rowKey={(a) => a.id}
          density="compact"
          empty={<p className="text-fg-secondary">{t("empty")}</p>}
        />
      </PanelBody>
    </Panel>
  );
}
