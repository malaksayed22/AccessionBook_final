/**
 * Theme preference: "system" follows the operating system, "light" and "dark" are explicit.
 *
 * The choice lives in a cookie so the server can render `<html data-theme>` on the first byte: no
 * flash of the wrong theme and no inline script (which the CSP would otherwise need a nonce for).
 * "system" leaves the attribute off and the CSS `prefers-color-scheme` rules decide.
 */
export const THEME_VALUES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_VALUES)[number];

export const THEME_COOKIE = "ab_theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function parseTheme(value: string | null | undefined): ThemePreference {
  return (THEME_VALUES as readonly string[]).includes(value ?? "")
    ? (value as ThemePreference)
    : "system";
}

/** The `data-theme` attribute for a preference; undefined means "let the OS decide". */
export function themeAttribute(preference: ThemePreference): "light" | "dark" | undefined {
  return preference === "system" ? undefined : preference;
}

/** Browser only: persists the preference and applies it immediately. */
export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  const attribute = themeAttribute(preference);
  if (attribute) root.setAttribute("data-theme", attribute);
  else root.removeAttribute("data-theme");
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
}
