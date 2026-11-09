import { FlaskConical, PackageCheck, Truck, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import type { OrganizationRelation } from "@/lib/organization-profile";

const ICON: Record<OrganizationRelation, LucideIcon> = {
  supplier: Truck,
  recipient: PackageCheck,
  lab: FlaskConical,
};

/** What an organization is to us (supplier, recipient, lab), told from the records that mention it. */
export function OrganizationRelations({
  relations,
  linked = true,
}: {
  relations: OrganizationRelation[];
  /** False where the badges already sit inside a link. */
  linked?: boolean;
}) {
  const t = useTranslations("organizations.relation");
  if (relations.length === 0) {
    return <span className="text-fg-secondary">{t("none")}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {relations.map((relation) => {
        const Icon = ICON[relation];
        return (
          <li key={relation}>
            <Badge
              tone="neutral"
              icon={<Icon />}
              href={linked ? `/records/organizations?relation=${relation}` : undefined}
            >
              {t(relation)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
