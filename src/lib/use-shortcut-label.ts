"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to — the platform does not change mid-session. */
const noopSubscribe = () => () => {};

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // `navigator.platform` is deprecated; prefer UA-CH where the browser has it.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Keyboard hint for the search shortcut: "⌘K" on Apple platforms, "Ctrl+K"
 * elsewhere.
 *
 * Read through `useSyncExternalStore` so the server renders "Ctrl+K" and the
 * client corrects it during hydration — setting it from an effect instead
 * triggers a cascading render on every mount.
 */
export function useShortcutLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (isApplePlatform() ? "⌘K" : "Ctrl+K"),
    () => "Ctrl+K"
  );
}
