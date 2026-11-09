import { getTranslations } from "next-intl/server";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/Breadcrumbs";
import { tabByKey, type NavTabKey } from "./nav-config";

/**
 * Breadcrumbs for a page that sits below a hub tab: "Inventory / Units / BD-001". The first two
 * crumbs come from the navigation config, so renaming a hub renames every trail. `current` is the
 * record's own name; use `kind` for the generic "New" and "Details" pages.
 */
export async function HubCrumbs({
  tab,
  trail = [],
  current,
  kind,
}: {
  tab: NavTabKey;
  /** Extra crumbs between the tab and the current page, e.g. an experiment above its labels. */
  trail?: BreadcrumbItem[];
  current?: string;
  kind?: "new" | "details" | "labels" | "log";
}) {
  const t = await getTranslations("shell");
  const { hub, tab: navTab } = tabByKey(tab);

  const items: BreadcrumbItem[] = [
    { label: t(`nav.hubs.${hub.key}.label`), href: hub.href },
    { label: t(`nav.tabs.${tab}.label`), href: navTab.href },
    ...trail,
  ];
  const leaf = current ?? (kind ? t(`breadcrumbs.${kind}`) : undefined);
  if (leaf) items.push({ label: leaf });

  return <Breadcrumbs items={items} className="app-chrome print:hidden" />;
}
