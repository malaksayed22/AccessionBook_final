import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { isKnownAction, isKnownEntityType } from "@/features/audit/links";
import { Link } from "@/i18n/navigation";

/*
 * Usage: <AuditActionBadge action="stage_transition" /> · <AuditEntityType type="unit" />
 * Audit entries store a machine action and record type. These show them in the reader's language,
 * and fall back to the stored value for one this version of the application does not know. Both link
 * to the audit trail filtered to that action or record type (`linked={false}` inside another link).
 */
export function AuditActionBadge({ action, linked = true }: { action: string; linked?: boolean }) {
  const t = useTranslations("activity.actions");
  return (
    <Badge
      tone="neutral"
      href={linked ? `/compliance/audit?action=${encodeURIComponent(action)}` : undefined}
    >
      {isKnownAction(action) ? t(action) : action}
    </Badge>
  );
}

export function AuditEntityType({ type, linked = true }: { type: string; linked?: boolean }) {
  const t = useTranslations("activity.entityTypes");
  const label = isKnownEntityType(type) ? t(type) : type;
  if (!linked) return <>{label}</>;
  return (
    <Link
      href={`/compliance/audit?entity=${encodeURIComponent(type)}`}
      className="inline-block min-h-6 leading-6 hover:underline"
    >
      {label}
    </Link>
  );
}
