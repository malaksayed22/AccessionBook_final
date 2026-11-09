import {
  Beaker,
  BookCheck,
  CalendarCheck,
  Boxes,
  Building2,
  Dna,
  FileBarChart,
  Flame,
  FlaskConical,
  LayoutDashboard,
  Library,
  MapPin,
  Microscope,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The application's information architecture, in one place: five hubs, each with the pages that
 * belong inside it. A hub owns a URL prefix (`/inventory/...`) and a layout that shows its tabs, so
 * a page is always reached as "hub, then tab". Labels and hints are not stored here: they live in
 * `messages/*\/shell.json` under `nav.hubs.<key>` and `nav.tabs.<key>` so both languages stay in
 * step.
 */
export const HUB_KEYS = ["dashboard", "inventory", "quality", "records", "compliance"] as const;
export type NavHubKey = (typeof HUB_KEYS)[number];

export const TAB_KEYS = [
  "units",
  "experiments",
  "materials",
  "destroyed",
  "tasks",
  "holds",
  "recall",
  "sops",
  "cultivars",
  "locations",
  "organizations",
  "members",
  "settings",
  "reports",
  "audit",
] as const;
export type NavTabKey = (typeof TAB_KEYS)[number];

export type NavTab = {
  key: NavTabKey;
  href: string;
  icon: LucideIcon;
  /** Only for those who read the compliance records: admins, quality assurance and inspectors. */
  complianceOnly?: boolean;
  /** Only for administrators. */
  adminOnly?: boolean;
};

export type NavHub = {
  key: NavHubKey;
  /** URL prefix every page of the hub starts with. */
  base: string;
  /** Where the hub's link goes: its first tab, or the page itself when it has no tabs. */
  href: string;
  icon: LucideIcon;
  tabs: NavTab[];
};

const hub = (key: NavHubKey, base: string, icon: LucideIcon, tabs: NavTab[]): NavHub => ({
  key,
  base,
  href: tabs[0]?.href ?? base,
  icon,
  tabs,
});

export const NAV_HUBS: NavHub[] = [
  hub("dashboard", "/dashboard", LayoutDashboard, []),
  hub("inventory", "/inventory", Boxes, [
    { key: "units", href: "/inventory/units", icon: Microscope },
    { key: "experiments", href: "/inventory/experiments", icon: FlaskConical },
    { key: "materials", href: "/inventory/materials", icon: Truck },
    { key: "destroyed", href: "/inventory/destroyed", icon: Flame },
    { key: "tasks", href: "/inventory/tasks", icon: CalendarCheck },
  ]),
  hub("quality", "/quality", ShieldCheck, [
    { key: "holds", href: "/quality", icon: Beaker },
    { key: "recall", href: "/quality/recall", icon: Undo2 },
    { key: "sops", href: "/quality/sops", icon: BookCheck },
  ]),
  hub("records", "/records", Library, [
    { key: "cultivars", href: "/records/cultivars", icon: Dna },
    { key: "locations", href: "/records/locations", icon: MapPin },
    { key: "organizations", href: "/records/organizations", icon: Building2 },
    { key: "members", href: "/records/members", icon: Users },
    { key: "settings", href: "/records/settings", icon: Settings, adminOnly: true },
  ]),
  hub("compliance", "/compliance", Scale, [
    { key: "reports", href: "/compliance/reports", icon: FileBarChart, complianceOnly: true },
    { key: "audit", href: "/compliance/audit", icon: ScrollText, complianceOnly: true },
  ]),
];

export function hubByKey(key: NavHubKey): NavHub {
  const found = NAV_HUBS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Unknown navigation hub: ${key}`);
  return found;
}

/** The hub and tab that own a tab key, for breadcrumbs. */
export function tabByKey(key: NavTabKey): { hub: NavHub; tab: NavTab } {
  for (const candidate of NAV_HUBS) {
    const tab = candidate.tabs.find((item) => item.key === key);
    if (tab) return { hub: candidate, tab };
  }
  throw new Error(`Unknown navigation tab: ${key}`);
}

/** The tabs a member may see in a hub; `hidden` are tabs of modules the lab has switched off. */
export function visibleTabs(
  navHub: NavHub,
  showCompliance: boolean,
  isAdmin = false,
  hidden: readonly NavTabKey[] = []
): NavTab[] {
  return navHub.tabs.filter(
    (tab) =>
      (showCompliance || !tab.complianceOnly) &&
      (isAdmin || !tab.adminOnly) &&
      !hidden.includes(tab.key)
  );
}

/** Every hub a member may reach, with its tabs already filtered. */
export function visibleHubs(
  showCompliance: boolean,
  isAdmin = false,
  hidden: readonly NavTabKey[] = []
): Array<NavHub & { tabs: NavTab[] }> {
  return NAV_HUBS.map((navHub) => ({
    ...navHub,
    tabs: visibleTabs(navHub, showCompliance, isAdmin, hidden),
  }));
}

/** `/inventory/units/12` is inside `/inventory/units`; `/inventory/unitsx` is not. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function hubForPath(pathname: string): NavHub | undefined {
  return NAV_HUBS.find((candidate) => isActivePath(pathname, candidate.base));
}

/**
 * The tab a path belongs to. Tabs can nest (`/compliance` holds `/compliance/reports`), so the
 * longest matching `href` wins.
 */
export function tabForPath(pathname: string): NavTab | undefined {
  return NAV_HUBS.flatMap((candidate) => candidate.tabs)
    .filter((tab) => isActivePath(pathname, tab.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
