import { ACTION_LABELS } from "@/lib/action-catalog";
import { formatAuditChanges } from "@/lib/audit-changes";
import { prisma } from "@/server/db";
import { formatLabDateTime, labZone, parseDateRange, periodFilter } from "./date-range";
import type { ReportFilters, ReportResult } from "./types";

export async function generateActivityAudit(filters: ReportFilters): Promise<ReportResult> {
  const zone = labZone();
  const period = parseDateRange(filters.from, filters.to, zone);
  const createdAt = periodFilter(period);

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(createdAt ? { createdAt } : {}),
      ...(filters.entityType && filters.entityType !== "all"
        ? { entityType: filters.entityType }
        : {}),
      ...(filters.action && filters.action !== "all" ? { action: filters.action } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
  });

  return {
    meta: {
      reportId: "activity-audit",
      title: "Member Activity Audit",
      generatedAt: new Date().toISOString(),
      periodLabel: period.label,
      subtitle: "Complete system mutation audit trail",
    },
    kpis: [
      { id: "totalEntries", label: "Total entries", value: logs.length },
      {
        id: "uniqueUsers",
        label: "Unique users",
        value: new Set(logs.map((l) => l.userId)).size,
      },
      {
        id: "unitEvents",
        label: "Unit events",
        value: logs.filter((l) => l.entityType === "unit").length,
      },
    ],
    sections: [
      {
        id: "audit-log",
        title: "Audit log",
        columns: [
          { key: "date", label: "Date / time" },
          { key: "user", label: "User" },
          { key: "role", label: "Role" },
          { key: "entity", label: "Entity" },
          { key: "action", label: "Action" },
          { key: "summary", label: "Summary" },
          { key: "changes", label: "Field changes" },
        ],
        rows: logs.map((l) => ({
          date: formatLabDateTime(l.createdAt, zone),
          user: l.userName,
          role: l.userRole,
          entity: `${l.entityType} ${l.entityLabel || l.entityId}`,
          action: ACTION_LABELS[l.action as keyof typeof ACTION_LABELS] ?? l.action,
          summary: l.summary,
          changes: formatAuditChanges(l.details, ""),
        })),
      },
    ],
  };
}
