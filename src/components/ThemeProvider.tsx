"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { applyTheme, type ThemePreference } from "@/lib/theme";

type ThemeContextValue = {
  /** What the user chose; "system" means follow the operating system. */
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The server renders `<html data-theme>` from the cookie, so `initial` already matches what is on
 * screen. Changing the theme updates the attribute and the cookie together.
 */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: ThemePreference;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<ThemePreference>(initial);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
