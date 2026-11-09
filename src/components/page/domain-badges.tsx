import { Dna, FlaskConical, Flower2, Leaf, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { BadgeTone, Status } from "@/components/ui/status-tones";

/*
 * Badges for the domain vocabulary. Labels come from messages/<locale>/domain.json; tone and icon are fixed
 * here, so a status looks the same on every screen. Work in server and client components.
 *
 * Every badge links to the list it names ("Plant" opens the plants, "In transit" the shipments in transit), so a
 * status is a way in, not just a label. Pass `linked={false}` where the badge already sits inside a
 * link or a button.
 */
type Linkable = { linked?: boolean };
type UnitType = "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE";
const TYPE_ICON: Record<UnitType, LucideIcon> = {
  PLANT: Leaf,
  SEEDLOT: Dna,
  FLOWER: Flower2,
  CULTURE: FlaskConical,
};

export function UnitTypeBadge({ type, linked = true }: { type: UnitType } & Linkable) {
  const t = useTranslations("domain.unitType");
  const Icon = TYPE_ICON[type];
  return (
    <Badge
      tone="neutral"
      icon={<Icon />}
      href={linked ? `/inventory/units?type=${type}` : undefined}
    >
      {t(type)}
    </Badge>
  );
}

/** Where a unit stands: active, on hold or destroyed. Shipping is not a status. */
export type UnitStatus = "active" | "on-hold" | "destroyed";

const UNIT_LIST_FILTER: Record<UnitStatus, string> = {
  active: "active",
  "on-hold": "hold",
  destroyed: "destroyed",
};

/**
 * `nothingLeft` marks an active unit whose stock was all shipped (or merged into another group): it
 * is shown as "Not active". Shipping is not a status of its own; the unit and its history stay on
 * record, and the badge links to the list of units that are not active.
 */
export function UnitStatusBadge({
  status,
  nothingLeft = false,
  linked = true,
}: { status: UnitStatus; nothingLeft?: boolean } & Linkable) {
  const t = useTranslations("domain.unitStatus");
  if (nothingLeft && status === "active") {
    return (
      <StatusBadge
        status="inactive"
        label={t("nothingLeft")}
        href={linked ? "/inventory/units?status=empty" : undefined}
      />
    );
  }
  return (
    <StatusBadge
      status={status as Status}
      label={t(status)}
      href={linked ? `/inventory/units?status=${UNIT_LIST_FILTER[status]}` : undefined}
    />
  );
}

const SHIPMENT_STATUS = {
  DRAFT: "draft",
  IN_TRANSIT: "in-transit",
  DELIVERED: "received",
  CANCELLED: "voided",
} as const satisfies Record<string, Status>;

export function ShipmentStatusBadge({
  status,
  linked = true,
}: { status: keyof typeof SHIPMENT_STATUS } & Linkable) {
  const t = useTranslations("domain.shipmentStatus");
  return (
    <StatusBadge
      status={SHIPMENT_STATUS[status]}
      label={t(status)}
      href={linked ? `/inventory/materials?status=${status}` : undefined}
    />
  );
}

const SEVERITY_TONE: Record<"CRITICAL" | "MAJOR" | "MINOR", BadgeTone> = {
  CRITICAL: "danger",
  MAJOR: "warning",
  MINOR: "neutral",
};

export function SeverityBadge({
  severity,
  linked = true,
}: { severity: keyof typeof SEVERITY_TONE } & Linkable) {
  const t = useTranslations("domain.incidentSeverity");
  return (
    <Badge
      tone={SEVERITY_TONE[severity]}
      href={linked ? `/quality?view=incidents&severity=${severity}` : undefined}
    >
      {t(severity)}
    </Badge>
  );
}

export function HoldBadge({ kind, linked = true }: { kind: "HOLD" } & Linkable) {
  const t = useTranslations("domain.holdKind");
  return (
    <StatusBadge
      status="on-hold"
      label={t(kind)}
      href={linked ? "/quality?view=holds" : undefined}
    />
  );
}

export function MemberStatusBadge({
  status,
  linked = true,
}: { status: "active" | "invited" | "deactivated" } & Linkable) {
  const t = useTranslations("domain.memberStatus");
  const tone: BadgeTone =
    status === "active" ? "success" : status === "invited" ? "info" : "neutral";
  return (
    <Badge tone={tone} href={linked ? `/records/members?status=${status}` : undefined}>
      {t(status)}
    </Badge>
  );
}
