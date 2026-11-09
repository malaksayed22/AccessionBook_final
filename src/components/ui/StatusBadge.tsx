import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeProps } from "./Badge";
import { STATUS_TONE, type BadgeTone, type Status } from "./status-tones";

/*
 * Usage: <StatusBadge status="on-hold" label={t("units.status.onHold")} />
 * The caller passes the translated `label`; this component owns the tone and the icon. Each tone
 * has its own icon shape, so the status reads without colour. It is drawn plain (coloured icon and
 * text, no pill) so a column of statuses stays quiet. Statuses that share a tone are told
 * apart by their label.
 */
const TONE_ICON: Record<BadgeTone, LucideIcon> = {
  neutral: CircleDashed,
  accent: CircleDot,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

export type StatusBadgeProps = Omit<BadgeProps, "tone" | "icon" | "children"> & {
  status: Status;
  /** Translated, human readable status name. */
  label: string;
};

export function StatusBadge({ status, label, ...rest }: StatusBadgeProps) {
  const tone = STATUS_TONE[status];
  const Icon = TONE_ICON[tone];
  return (
    <Badge plain tone={tone} icon={<Icon />} data-status={status} {...rest}>
      {label}
    </Badge>
  );
}
