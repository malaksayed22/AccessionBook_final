"use client";

import { createContext, useContext } from "react";
import type { NavTabKey } from "./nav-config";

/** `hiddenTabs`: tabs of modules the lab has switched off, left out of the navigation. */
type ShellState = { showCompliance: boolean; hiddenTabs: readonly NavTabKey[] };

const ShellContext = createContext<ShellState>({ showCompliance: false, hiddenTabs: [] });

/** What the signed-in frame knows about the viewer, for navigation that sits inside a page layout. */
export const ShellProvider = ShellContext.Provider;

export function useShell(): ShellState {
  return useContext(ShellContext);
}
