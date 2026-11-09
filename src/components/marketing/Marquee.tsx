import { useTranslations } from "next-intl";

const ITEMS = [
  "units",
  "derivation",
  "custody",
  "quality",
  "reporting",
  "audit",
  "inventory",
  "workspace",
] as const;

/**
 * A slow, endless ribbon of what the platform covers. Pure CSS (a translate loop over two copies of
 * the list), so it costs no JavaScript. The second copy is hidden from assistive technology and the
 * loop stops for visitors who prefer reduced motion.
 */
export function Marquee() {
  const t = useTranslations("marketing");
  const row = (hidden: boolean) => (
    <ul
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center gap-8 pr-8 motion-reduce:flex-wrap"
    >
      {ITEMS.map((key) => (
        <li key={key} className="flex items-center gap-8">
          <span className="text-sm font-medium tracking-wide whitespace-nowrap text-fg-secondary uppercase">
            {t(`capabilities.items.${key}.title`)}
          </span>
          <span aria-hidden="true" className="size-1 rounded-full bg-border-strong" />
        </li>
      ))}
    </ul>
  );

  return (
    <section
      aria-label={t("marquee.label")}
      className="overflow-hidden border-b border-border bg-surface py-4 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]"
    >
      <div className="flex w-max animate-[marquee_60s_linear_infinite] hover:[animation-play-state:paused] motion-reduce:w-auto motion-reduce:animate-none">
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}
