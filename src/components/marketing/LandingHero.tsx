import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { PillLink } from "./PillLink";
import { SOFT_TEXT } from "./softText";

/**
 * The landing hero: a full-width photograph under a dark shadow, with the headline, one short
 * paragraph and one action set on top. Fully static: no scene, no scroll pinning, no motion.
 *
 * `scope-dark` paints the section in the dark palette whatever the visitor's theme is, so the
 * overlay (`bg-bg`) is always the deep navy and the type (`text-fg`) always reads as light on it.
 * The shadow is heavier on the start side, where the copy sits, and eases off over the subject.
 */
export async function LandingHero() {
  const t = await getTranslations("marketing");

  return (
    <section
      aria-labelledby="hero-title"
      className="scope-dark relative isolate flex min-h-svh flex-col overflow-hidden bg-bg text-fg"
    >
      <Image
        src="/landing/hero.jpg"
        alt=""
        fill
        preload
        sizes="100vw"
        className="-z-20 object-cover object-center"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-bg/50 max-md:bg-bg/85" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-r from-bg/95 via-bg/60 via-55% to-transparent max-md:hidden"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-linear-to-t from-bg to-transparent"
      />

      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pt-32 pb-16 sm:px-6",
          SOFT_TEXT
        )}
      >
        <p className="font-mono text-xs tracking-[0.14em] text-accent-text uppercase">
          {t("hero.kicker")}
        </p>

        <h1
          id="hero-title"
          className="mt-6 max-w-3xl text-5xl leading-[1] font-semibold tracking-[-0.025em] text-balance sm:text-6xl lg:text-7xl"
        >
          <span className="block">{t("hero.titleLead")}</span>
          <span className="block pb-[0.1em] font-serif font-normal tracking-[-0.02em] text-accent-text italic">
            {t("hero.titleTail")}
          </span>
        </h1>

        <p className="mt-8 max-w-xl border-s-2 border-accent-text ps-6 text-base leading-relaxed text-fg-secondary sm:text-lg">
          {t("hero.lead")}
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <PillLink
            href="#platform"
            variant="outline"
            size="lg"
            className="max-sm:w-full max-sm:py-3.5"
          >
            {t("hero.learnMore")}
          </PillLink>
        </div>
      </div>
    </section>
  );
}
