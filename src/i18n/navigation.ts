import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware replacements for `next/link` and the `next/navigation` router hooks. Hand them a
 * plain path ("/units/12") and they add the current language prefix. `usePathname` returns the path
 * without the prefix, so "is this nav item active" checks stay language-independent.
 *
 * Server-side `redirect("/login")` from `next/navigation` still works: the proxy adds the prefix.
 */
export const { Link, usePathname, useRouter, getPathname } = createNavigation(routing);
