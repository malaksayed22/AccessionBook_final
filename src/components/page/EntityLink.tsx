import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/*
 * Usage: <EntityLink kind="cultivar" id={row.cultivarId}>{row.cultivarName}</EntityLink>
 * The one way a record's name becomes a link, so every page sends the same name to the same place:
 * a unit, experiment, cultivar, organization, member, shipment or location (a room) to its page. With no `id` (an optional relation that is empty) it renders the plain text, so
 * callers do not need a ternary. Server and client friendly.
 */
export type EntityKind =
  "unit" | "experiment" | "cultivar" | "organization" | "member" | "shipment" | "location";

const HREF: Record<EntityKind, (id: number) => string> = {
  unit: (id) => `/inventory/units/${id}`,
  experiment: (id) => `/inventory/experiments/${id}`,
  cultivar: (id) => `/records/cultivars/${id}`,
  organization: (id) => `/records/organizations/${id}`,
  member: (id) => `/records/members/${id}`,
  shipment: (id) => `/inventory/materials/${id}`,
  location: (id) => `/records/locations/${id}`,
};

export const entityHref = (kind: EntityKind, id: number) => HREF[kind](id);

export function EntityLink({
  kind,
  id,
  children,
  className,
}: {
  kind: EntityKind;
  id: number | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  if (id === null || id === undefined) return <>{children}</>;
  return (
    <Link
      href={HREF[kind](id)}
      // 24px tall so stacked links in table rows meet the WCAG 2.2 target-size minimum.
      className={cn(
        "inline-block min-h-6 align-baseline font-medium leading-6 text-accent-text hover:underline",
        className
      )}
    >
      {children}
    </Link>
  );
}
