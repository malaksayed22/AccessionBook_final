/**
 * Used as the `template.tsx` of every hub. A template, unlike a layout, mounts afresh on each
 * navigation, so the page eases in while the hub's tab row (in the layout above it) stays put. The
 * effect is CSS only (`.page-in`) and the global reduced-motion rule switches it off.
 */
export function PageTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
