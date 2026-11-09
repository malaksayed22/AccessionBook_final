"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { PillLink } from "./PillLink";
import type { DnaScene } from "./dna-scene";
import { EASE_OUT, gsap, MASK_HIDE, padMasks, ScrollTrigger, SplitText } from "./gsap";
import { Magnetic } from "./Magnetic";

const MODEL_URL = "/models/dna.glb";
const TRUST = ["returns", "destruction", "audit", "access"] as const;
const CALLOUTS = [
  // Phones and tablets have room for one callout under the helix; wide screens place all three around it.
  { key: "lineage", position: "lg:top-[26%] lg:left-[7%]" },
  { key: "custody", position: "hidden lg:block lg:top-[40%] lg:right-[7%] lg:left-auto" },
  { key: "audit", position: "hidden lg:block lg:top-[68%] lg:left-[12%]" },
] as const;

/** Scroll distance the hero stays pinned for, as a share of the viewport height. */
const PIN_DISTANCE = "+=230%";

/**
 * The landing hero. A full-screen 3D double helix sits beside the headline; as the visitor scrolls
 * the hero stays pinned while the helix zooms in, turns and straightens up, three callouts appear
 * beside it, and only when it has reached full size does the pin release and the page move on.
 *
 * The scroll is one GSAP timeline scrubbed by ScrollTrigger. It drives `scene.state.zoom` (0 to 1),
 * which the three.js scene turns into scale, rotation and camera distance.
 *
 * Without motion (prefers-reduced-motion) or without WebGL the hero is a normal static section: the
 * helix is drawn once at full size, or replaced by a ring, and nothing is pinned.
 */
export function HelixHero({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("marketing");
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLSpanElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const media = gsap.matchMedia();
    media.add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        still: "(prefers-reduced-motion: reduce)",
      },
      (context) => {
        const still = Boolean(context.conditions?.still);
        const scope = gsap.context(() => {}, root);
        let scene: DnaScene | undefined;
        let watcher: IntersectionObserver | undefined;
        let stopped = false;

        if (!still) scope.add(() => playIntro());

        void import("./dna-scene").then(async ({ DnaScene: Scene }) => {
          if (stopped) return;
          try {
            scene = new Scene(canvas, { modelUrl: MODEL_URL, reducedMotion: still });
            await scene.load();
          } catch {
            scene?.dispose();
            scene = undefined;
            if (!stopped) setFallback(true);
            return;
          }
          if (stopped) {
            scene.dispose();
            return;
          }
          setReady(true);

          if (still) {
            scene.state.zoom = 1;
            scene.renderOnce();
            return;
          }

          const live = scene;
          live.setActive(true);
          watcher = new IntersectionObserver(([entry]) =>
            live.setActive(Boolean(entry?.isIntersecting))
          );
          watcher.observe(root);
          scope.add(() => buildScrollTimeline(live));
        });

        return () => {
          stopped = true;
          watcher?.disconnect();
          scope.revert();
          scene?.dispose();
        };
      }
    );

    /** Headline: lines slide up out of a mask, then the supporting copy follows. */
    function playIntro() {
      const lead = leadRef.current;
      const tail = tailRef.current;
      const copy = copyRef.current;
      if (!lead || !tail || !copy) return;

      void document.fonts.ready.then(() => {
        const splits = [lead, tail].map((el) =>
          SplitText.create(el, { type: "lines", mask: "lines", aria: "none" })
        );
        splits.forEach((split) => padMasks(split));
        const lines = splits.flatMap((split) => split.lines as HTMLElement[]);
        const rest = copy.querySelectorAll("[data-intro-item]");

        gsap.set(lines, { yPercent: MASK_HIDE });
        gsap.set(rest, { autoAlpha: 0, y: 24 });
        copy.removeAttribute("data-intro");

        gsap
          .timeline({ defaults: { ease: EASE_OUT } })
          .to(lines, { yPercent: 0, duration: 1.2, stagger: 0.14 }, 0.1)
          .to(rest, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.09 }, 0.5);
      });
    }

    /** The pinned scroll story: zoom the helix to full size, reveal the callouts, then release. */
    function buildScrollTimeline(live: DnaScene) {
      const timeline = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: PIN_DISTANCE,
          pin: true,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          // The hero is created after the model loads, later than the triggers below it. Refreshing it first
          // adds its pin spacer before they measure, so their start positions are right.
          refreshPriority: 10,
        },
      });

      timeline
        .to(live.state, { zoom: 1, duration: 1 }, 0)
        .to(
          copyRef.current,
          { yPercent: -14, autoAlpha: 0, duration: 0.3, ease: "power2.in" },
          0.04
        )
        .fromTo(
          root?.querySelectorAll("[data-callout]") ?? [],
          { autoAlpha: 0, x: 24 },
          { autoAlpha: 1, x: 0, duration: 0.2, stagger: 0.12, ease: "power3.out" },
          0.58
        );

      ScrollTrigger.refresh();
    }

    return () => media.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      aria-labelledby="hero-title"
      className="grain relative isolate h-svh min-h-160 overflow-hidden border-b border-border bg-bg"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="dot-grid absolute inset-0 opacity-60 mask-[radial-gradient(ellipse_at_60%_45%,black,transparent_75%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_48%,var(--color-accent-soft),transparent_55%)]" />
      </div>

      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          data-ready={ready}
          className="size-full opacity-0 transition-opacity duration-1000 data-[ready=true]:opacity-100"
        />
        {fallback ? (
          <div
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 size-[min(56vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-soft-border"
          >
            <div className="absolute inset-[12%] rounded-full border border-accent-soft-border" />
            <div className="absolute inset-[26%] rounded-full border border-accent-soft-border" />
          </div>
        ) : null}
      </div>

      <div
        ref={copyRef}
        data-intro="pending"
        className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-center px-4 pt-24 pb-12 sm:px-6 sm:pt-20 sm:pb-56 lg:pb-44"
      >
        <div className="max-w-3xl">
          <p
            data-intro-item
            className="inline-flex items-center gap-3 rounded-full border border-border bg-surface/60 py-1.5 pr-4 pl-1.5 backdrop-blur"
          >
            <span className="rounded-full bg-hover px-2.5 py-0.5 font-mono text-[0.75rem] tracking-[0.08em] text-fg uppercase">
              {t("hero.badge")}
            </span>
            <span className="font-mono text-xs tracking-[0.12em] text-fg-secondary uppercase">
              {t("hero.kicker")}
            </span>
          </p>

          <h1
            id="hero-title"
            className="mt-7 text-[2.75rem] leading-[0.98] font-semibold tracking-[-0.045em] text-balance min-[400px]:text-6xl sm:mt-8 sm:text-7xl lg:text-[5.75rem]"
          >
            <span ref={leadRef} className="block pb-[0.08em]">
              {t("hero.titleLead")}
            </span>
            <span
              ref={tailRef}
              className="block pb-[0.14em] font-serif font-normal tracking-[-0.02em] text-fg-secondary italic"
            >
              {t("hero.titleTail")}
            </span>
          </h1>

          <p
            data-intro-item
            className="mt-6 max-w-xl text-base leading-relaxed text-fg-secondary sm:mt-7 sm:text-lg"
          >
            {t("hero.lead")}
          </p>

          <div
            data-intro-item
            className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap"
          >
            <Magnetic className="max-sm:w-full">
              <PillLink
                href={signedIn ? "/dashboard" : "/login"}
                size="lg"
                className="max-sm:w-full max-sm:py-3.5"
              >
                {signedIn ? t("hero.primarySignedIn") : t("header.signIn")}
              </PillLink>
            </Magnetic>
            <Magnetic className="max-sm:w-full">
              <PillLink
                href="#platform"
                variant="outline"
                size="lg"
                className="max-sm:w-full max-sm:bg-bg/70 max-sm:py-3.5 max-sm:backdrop-blur"
              >
                {t("hero.learnMore")}
              </PillLink>
            </Magnetic>
          </div>
        </div>

        <ul
          data-intro-item
          className="absolute inset-x-4 bottom-8 hidden grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface/60 backdrop-blur-md sm:inset-x-6 sm:grid lg:grid-cols-4"
        >
          {TRUST.map((item, index) => (
            <li key={item} className="px-5 py-3 lg:py-4">
              <p className="font-mono text-[0.75rem] tracking-[0.14em] text-fg-tertiary uppercase">
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="mt-2 text-sm font-medium">{t(`hero.trust.${item}`)}</p>
            </li>
          ))}
        </ul>
      </div>

      {CALLOUTS.map(({ key, position }) => (
        <div
          key={key}
          data-callout
          className={`absolute inset-x-4 bottom-8 z-10 max-w-xs text-center text-balance opacity-0 [text-shadow:0_0_18px_var(--color-bg),0_0_6px_var(--color-bg)] motion-reduce:opacity-100 sm:inset-x-auto sm:bottom-24 sm:left-1/2 sm:-translate-x-1/2 lg:bottom-auto lg:translate-x-0 ${position}`}
        >
          <p className="font-mono text-xs tracking-[0.18em] text-accent-text uppercase">
            {t(`hero.callouts.${key}.label`)}
          </p>
          <p className="mx-auto mt-2.5 text-sm leading-relaxed text-fg-secondary">
            {t(`hero.callouts.${key}.body`)}
          </p>
        </div>
      ))}
    </section>
  );
}
