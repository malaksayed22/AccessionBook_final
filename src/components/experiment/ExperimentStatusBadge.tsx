import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ExperimentStatus } from "@/features/experiment/dates";

/** Running or completed, as computed from the experiment's end date. Icon and text, never colour alone. */
export function ExperimentStatusBadge({
  status,
  linked = true,
}: {
  status: ExperimentStatus;
  /** False where the badge already sits inside a link, e.g. a card. */
  linked?: boolean;
}) {
  const t = useTranslations("domain.experimentStatus");
  const href = linked
    ? `/inventory/experiments?status=${status === "active" ? "running" : "completed"}`
    : undefined;
  if (status === "active") return <StatusBadge status="active" label={t("active")} href={href} />;
  return (
    <Badge tone="neutral" icon={<CircleCheck />} data-status="completed" href={href}>
      {t("completed")}
    </Badge>
  );
}
