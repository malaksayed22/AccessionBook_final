import { Link } from "@/i18n/navigation";
import { BRAND } from "@/lib/brand";

const MARK_SIZES = {
  sm: 26,
  md: 32,
  lg: 40,
  xl: 48,
} as const;

const TEXT_SIZES = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-3xl",
} as const;

type Size = keyof typeof MARK_SIZES;

/**
 * Double helix: two strands that cross twice, joined by base-pair rungs.
 *
 * Drawn with strokes in `currentColor` (or `color`), so it inherits the surrounding colour and has
 * no gradient ids to collide when several instances render on one page.
 *
 * Geometry lives on a 32x32 grid; keep icon.svg in step if you change these paths.
 */
export const BRAND_MARK = {
  strands: [
    "M10 3 C10 10 22 10 22 16 C22 22 10 22 10 29",
    "M22 3 C22 10 10 10 10 16 C10 22 22 22 22 29",
  ],
  rungs: ["M12.4 6.2 H19.6", "M14.4 9.6 H17.6", "M14.4 22.4 H17.6", "M12.4 25.8 H19.6"],
};

export function BrandMark({
  size = 32,
  className = "",
  color = "currentColor",
}: {
  size?: number;
  className?: string;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label={`${BRAND.name} logo`}
      className={`shrink-0 ${className}`}
    >
      <g stroke={color} strokeLinecap="round" strokeWidth="2.6">
        {BRAND_MARK.strands.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g stroke={color} strokeLinecap="round" strokeWidth="1.8" opacity="0.7">
        {BRAND_MARK.rungs.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
export function BrandWordmark({
  size = "md",
  className = "",
}: {
  size?: Size;
  className?: string;
}) {
  return (
    <span className={`font-semibold tracking-tight ${TEXT_SIZES[size]} ${className}`}>
      {BRAND.wordmark.lead}
      <span className="text-accent-text">{BRAND.wordmark.tail}</span>
    </span>
  );
}

function MarkBadge({ size }: { size: Size }) {
  const px = MARK_SIZES[size];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[24%] bg-accent text-on-accent"
      style={{ width: px, height: px }}
    >
      <BrandMark size={Math.round(px * 0.74)} />
    </span>
  );
}

/**
 * Full lockup — badge mark plus wordmark, optionally with the subtitle.
 * Pass `href` to make it a link.
 */
export function BrandLogo({
  size = "md",
  showSubtitle = false,
  href,
  className = "",
}: {
  size?: Size;
  showSubtitle?: boolean;
  href?: string;
  className?: string;
}) {
  const content = (
    <span className="flex items-center gap-2.5">
      <MarkBadge size={size} />
      <span className="flex flex-col leading-none">
        <BrandWordmark size={size} />
        {showSubtitle && <span className="mt-1 text-xs text-fg-secondary">{BRAND.subtitle}</span>}
      </span>
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={`${BRAND.name} home`}
        className={`inline-flex rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus ${className}`}
      >
        {content}
      </Link>
    );
  }

  return <span className={`inline-flex ${className}`}>{content}</span>;
}

/** Compact lockup linking home — sidebar and mobile header. */
export function BrandLogoLink({ className = "" }: { className?: string }) {
  // sm keeps the two-word wordmark inside the narrow sidebar.
  return <BrandLogo href="/" size="sm" className={className} />;
}
