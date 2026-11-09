import { Download, Paperclip } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { formatFileSize } from "@/components/experiment/document-upload";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import type { OrganizationDocumentRow } from "@/features/organization/queries";

/** The documents filed with the organization, newest first; each downloads through the signed-in route. */
export function DocumentsPanel({
  organizationId,
  documents,
}: {
  organizationId: number;
  documents: OrganizationDocumentRow[];
}) {
  const t = useTranslations("organizations.documents");
  const format = useFormatter();

  return (
    <Panel>
      <PanelHeader title={t("title")} description={t("description")} />
      <PanelBody>
        {documents.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("none")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((document) => (
              <li key={document.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Paperclip aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-tertiary" />
                <div className="min-w-0">
                  <a
                    href={`/api/organizations/${organizationId}/documents/${document.id}`}
                    className="inline-flex min-h-6 items-center gap-1.5 font-medium text-accent-text hover:underline"
                  >
                    {document.label}
                    <Download aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">{t("download")}</span>
                  </a>
                  <p className="text-sm text-fg-secondary">
                    {document.fileName}
                    {document.sizeBytes ? ` · ${formatFileSize(document.sizeBytes)}` : ""}
                    {" · "}
                    {t("addedBy", {
                      name: document.userName,
                      date: format.dateTime(document.createdAt, "date"),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
