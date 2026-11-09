import { ImageIcon, Play } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

const PHOTOS = ["one", "two", "three"] as const;

/** Four L-shaped marks that frame a media slot, drawn with borders so they follow the palette. */
function CornerBrackets({ inset }: { inset: string }) {
  const mark = "absolute size-5 border-fg-tertiary";
  return (
    <>
      <span aria-hidden="true" className={cn(mark, inset, "top-0 left-0 border-t border-l")} />
      <span aria-hidden="true" className={cn(mark, inset, "top-0 right-0 border-t border-r")} />
      <span aria-hidden="true" className={cn(mark, inset, "bottom-0 left-0 border-b border-l")} />
      <span aria-hidden="true" className={cn(mark, inset, "right-0 bottom-0 border-r border-b")} />
    </>
  );
}

/**
 * The product video: a title above, then a dark frame with a play button. It is not wired to a file
 * yet, so the frame is artwork (hidden from assistive tech) and the play button is not a control.
 * Swap the figure's contents for a `<video>` or an embed when the film exists. `scope-dark` keeps
 * the frame dark in either theme.
 */
export async function VideoSection() {
  const t = await getTranslations("marketing.video");

  return (
    <section
      id="platform"
      aria-labelledby="video-title"
      className="scroll-mt-20 border-b border-border pt-28 pb-20 sm:pt-36 sm:pb-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2
          id="video-title"
          className="max-w-4xl text-4xl leading-[1.04] font-semibold tracking-[-0.025em] text-balance sm:text-5xl lg:text-7xl"
        >
          {BRAND.name} <span aria-hidden="true">·</span>{" "}
          <span className="font-serif font-normal tracking-[-0.02em] text-accent-text italic">
            {t("titleAccent")}
          </span>
        </h2>
        <figure
          aria-hidden="true"
          className="scope-dark relative isolate mt-10 flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-border bg-bg text-fg sm:mt-14"
        >
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_75%_30%,var(--color-accent-soft),transparent_60%)]" />
          <div className="absolute inset-3 sm:inset-6">
            <CornerBrackets inset="" />
          </div>
          <span className="flex size-12 items-center justify-center rounded-full border border-fg/30 bg-fg/15 backdrop-blur-sm sm:size-16">
            <Play className="size-4 translate-x-px fill-current sm:size-5" />
          </span>
        </figure>
      </div>
    </section>
  );
}

/** Three photo slots, each with a small mono tag, a title and a line of text underneath. */
export async function PhotoPlaceholders() {
  const t = await getTranslations("marketing.gallery");

  return (
    <section
      id="gallery"
      aria-labelledby="gallery-title"
      className="border-b border-border py-20 sm:py-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2
          id="gallery-title"
          className="max-w-4xl text-4xl leading-[1.04] font-semibold tracking-[-0.025em] text-balance sm:text-5xl lg:text-7xl"
        >
          {t("title")}{" "}
          <span className="font-serif font-normal tracking-[-0.02em] text-accent-text italic">
            {t("titleAccent")}
          </span>
        </h2>
        <p className="mt-8 max-w-3xl border-s-2 border-accent-text ps-6 text-base leading-relaxed text-fg-secondary sm:text-lg">
          {t("intro")}
        </p>
        <ul className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {PHOTOS.map((photo) => (
            <li key={photo}>
              <div
                aria-hidden="true"
                className="scope-dark relative flex aspect-[16/10] items-center justify-center rounded-lg border border-border bg-bg text-fg-tertiary"
              >
                <div className="absolute inset-3">
                  <CornerBrackets inset="" />
                </div>
                <ImageIcon className="size-8" strokeWidth={1.5} />
              </div>
              <p className="mt-5 font-mono text-xs tracking-[0.14em] text-accent-text uppercase">
                {t(`items.${photo}.tag`)}
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight">
                {t(`items.${photo}.title`)}
              </h3>
              <p className="mt-2 leading-relaxed text-fg-secondary">{t(`items.${photo}.text`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
