/**
 * Class fragments shared by several primitives. Colours always come from the tokens in
 * src/styles/tokens.css through Tailwind utilities; never write a raw colour here.
 */

/** Visible keyboard focus. The ring colour is `--color-focus` (3:1 on every surface, both themes). */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * Shared look of text inputs, selects and textareas: a hairline-bordered rounded field that picks up
 * the focus ring, and turns red when `aria-invalid` is set. The border is the 3:1 control border.
 */
export const controlBase =
  "block w-full min-h-11 pointer-coarse:min-h-12 rounded-[0.625rem] border border-border-input bg-sunken/70 px-4 py-2.5 text-base leading-6 tracking-[-0.005em] text-fg shadow-xs " +
  "placeholder:text-fg-tertiary " +
  "transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none " +
  "hover:border-fg-tertiary " +
  "focus-visible:border-focus focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-focus)_16%,transparent)] " +
  "aria-invalid:border-danger aria-invalid:hover:border-danger " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Borderless "line" control for list toolbars (search, sort, date range): only a hairline under the
 * text, which thickens and takes the focus colour when active. The transparent outline is kept so
 * forced-colours mode still shows where focus is. The hairline is the same 3:1 control border.
 */
export const lineControl =
  "block w-full min-h-10 pointer-coarse:min-h-11 rounded-none border-0 border-b border-border-input bg-transparent px-0 py-2 text-sm leading-5 text-fg " +
  "placeholder:text-fg-tertiary " +
  "transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none " +
  "hover:border-fg-tertiary " +
  "focus-visible:border-focus focus-visible:shadow-[0_1px_0_0_var(--color-focus)] focus-visible:outline-2 focus-visible:outline-transparent " +
  "aria-invalid:border-danger aria-invalid:hover:border-danger " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Small mono caption above a toolbar control, matching the filter group labels. */
export const toolbarLabel =
  "block font-mono text-[0.75rem] leading-4 tracking-[0.1em] text-fg-tertiary uppercase";

export type SoftToneName = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

/** Soft (tinted) surfaces with their border and a text colour verified for AA on that tint. */
export const softTone: Record<SoftToneName, string> = {
  neutral: "bg-neutral-soft border-neutral-soft-border text-fg-secondary",
  accent: "bg-accent-soft border-accent-soft-border text-accent-text",
  info: "bg-info-soft border-info-soft-border text-info",
  success: "bg-success-soft border-success-soft-border text-success",
  warning: "bg-warning-soft border-warning-soft-border text-warning",
  danger: "bg-danger-soft border-danger-soft-border text-danger",
};

/** Table header and cell classes. Headers are small mono capitals so the data carries the weight; the table itself has no box, only hairlines. */
export const thBase =
  "border-b border-border-strong bg-transparent px-4 py-3 text-left font-mono text-[0.75rem] leading-4 font-medium tracking-[0.1em] text-fg-tertiary uppercase align-bottom";
export const tdBase = "border-b border-border px-4 text-sm leading-5 text-fg align-top";
