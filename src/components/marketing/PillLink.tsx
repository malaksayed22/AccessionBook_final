import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const VARIANTS = {
  /** Filled with the foreground colour: white on dark, navy on light. The main action. */
  solid: "bg-fg text-bg hover:bg-fg/85",
  /** Hairline outline for secondary actions and the header. */
  outline: "border border-border-strong text-fg hover:border-fg-tertiary hover:bg-hover",
} as const;

const SIZES = {
  sm: "gap-1.5 px-4 py-2 text-sm",
  md: "gap-2 px-6 py-3 text-sm",
  lg: "gap-2.5 px-8 py-4 text-base",
} as const;

/**
 * The public site's call-to-action: a pill with an arrow that nudges up and to the right on hover.
 * Server-safe (no state), and it renders the locale-aware `Link`, so `#anchors` and routes both work.
 */
export function PillLink({
  href,
  variant = "solid",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex min-h-10 items-center justify-center rounded-full font-medium whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
    >
      {children}
      <ArrowUpRight
        aria-hidden="true"
        className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}
