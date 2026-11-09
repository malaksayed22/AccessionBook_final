import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { softTone, type SoftToneName } from "./styles";
import type { BadgeTone } from "./status-tones";

/*
 * Usage: <Badge tone="warning" icon={<TriangleAlert />}>Needs review</Badge>
 * Small label on a softly tinted, square-cornered surface (no outline). `plain` drops the surface and
 * leaves just the coloured icon and text, which is how <StatusBadge> reads inside tables and lists.
 * For record statuses use <StatusBadge>, which adds the icon.
 * Colour is never the only signal: pass an `icon` or make the text say what the tone means.
 * With `href` the badge is a link (to the list it names); it keeps its look and gains a hover ring.
 */
/** Text colours for `plain` badges; each is the same verified-AA colour the tinted badge uses. */
const plainTone: Record<SoftToneName, string> = {
  neutral: "text-fg-secondary",
  accent: "text-accent-text",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export type BadgeProps = ComponentProps<"span"> & {
  tone?: BadgeTone;
  /** No tinted surface: just the coloured icon and text. */
  plain?: boolean;
  /** Makes the badge a link. Do not set it when the badge already sits inside a link or a button. */
  href?: string;
  /** Decorative icon (hidden from assistive technology). */
  icon?: ReactNode;
};

export function Badge({
  tone = "neutral",
  plain = false,
  href,
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  const classes = cn(
    "inline-flex max-w-full items-center gap-1.5 text-xs leading-5 font-medium",
    plain ? plainTone[tone] : cn("rounded-md border px-2 py-0.5", softTone[tone]),
    href &&
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none",
    href && (plain ? "hover:underline" : "transition-shadow hover:ring-2 hover:ring-border-strong"),
    className
  );
  const content = (
    <>
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 wrap-break-word">{children}</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes} {...(rest as object)}>
        {content}
      </Link>
    );
  }
  return (
    <span className={classes} {...rest}>
      {content}
    </span>
  );
}
