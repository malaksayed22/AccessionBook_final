"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { GitBranch, Lock, Undo2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT, gsap } from "./gsap";
import { useReducedMotion } from "./motion";

const PILLARS = [
  { key: "lineage", icon: GitBranch },
  { key: "holds", icon: Lock },
  { key: "recall", icon: Undo2 },
] as const satisfies ReadonlyArray<{ key: string; icon: LucideIcon }>;
type PillarKey = (typeof PILLARS)[number]["key"];

const CYCLE_MS = 7200;

/** Artwork only: an example identifier in the product mock-up, identical in every language. */
const SAMPLE_CODE = "SMP-1039";

/**
 * The three guarantees as an index on the left and a live stage on the right. Radix supplies the
 * keyboard pattern (arrow keys, Home and End). The tabs rotate by themselves only while the block is
 * on screen, the pointer and keyboard focus are elsewhere, and the visitor has not asked for reduced
 * motion; choosing a tab by hand stops nothing but restarts the timer.
 *
 * Each scene replays as a short GSAP timeline whenever its tab opens: connectors draw themselves,
 * packets travel along them, the hold gauge fills past its limit. With reduced motion the scenes are
 * simply drawn in their final state.
 */
export function PillarStage() {
  const t = useTranslations("marketing.platform");
  const reduced = useReducedMotion();
  const [active, setActive] = useState<PillarKey>("lineage");
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(Boolean(entry?.isIntersecting)),
      { threshold: 0.35 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const playing = !reduced && onScreen && !paused;

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      setActive((current) => {
        const index = PILLARS.findIndex((pillar) => pillar.key === current);
        return PILLARS[(index + 1) % PILLARS.length]!.key;
      });
    }, CYCLE_MS);
    return () => clearTimeout(id);
  }, [playing, active]);

  /** The glow on the stage follows the pointer through two CSS variables, with no React state. */
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const stage = event.currentTarget;
    const box = stage.getBoundingClientRect();
    stage.style.setProperty("--mx", `${event.clientX - box.left}px`);
    stage.style.setProperty("--my", `${event.clientY - box.top}px`);
  };

  return (
    <TabsPrimitive.Root
      value={active}
      onValueChange={(value) => setActive(value as PillarKey)}
      orientation="vertical"
      ref={rootRef}
      className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <TabsPrimitive.List aria-label={t("listLabel")} className="flex flex-col">
        {PILLARS.map(({ key, icon: Icon }, index) => {
          const selected = key === active;
          return (
            <TabsPrimitive.Trigger
              key={key}
              value={key}
              className={cn(
                "group relative -mx-3 grid grid-cols-[2.75rem_1fr] items-start border-t border-border px-3 py-6 text-start last:border-b",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              )}
            >
              <span className="pt-1.5 font-mono text-xs tracking-wider text-fg-tertiary transition-colors duration-300 group-data-[state=active]:text-accent-text">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-3">
                  <span className="text-xl leading-snug font-semibold tracking-tight text-fg-tertiary transition-colors duration-300 group-hover:text-fg group-data-[state=active]:text-fg sm:text-2xl">
                    {t(`pillars.${key}.title`)}
                  </span>
                  <Icon
                    aria-hidden="true"
                    className="size-4 shrink-0 -translate-x-2 text-accent-text opacity-0 transition-[opacity,translate] duration-500 group-data-[state=active]:translate-x-0 group-data-[state=active]:opacity-100"
                  />
                </span>
                <span className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-500 ease-out group-data-[state=active]:grid-rows-[1fr] group-data-[state=active]:opacity-100 motion-reduce:transition-none">
                  <span className="overflow-hidden">
                    <span className="block max-w-md pt-3 leading-relaxed text-fg-secondary">
                      {t(`pillars.${key}.body`)}
                    </span>
                  </span>
                </span>
              </span>
              <span aria-hidden="true" className="absolute inset-x-0 -top-px h-px overflow-hidden">
                {selected && playing ? (
                  <span
                    className="block h-full w-full bg-accent-text transition-[width] ease-linear starting:w-0"
                    style={{ transitionDuration: `${CYCLE_MS}ms` }}
                  />
                ) : selected ? (
                  <span className="block h-full w-full bg-accent-text" />
                ) : null}
              </span>
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>

      <div
        onPointerMove={follow}
        className="group/stage relative isolate overflow-hidden rounded-2xl border border-border bg-surface"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="dot-grid absolute inset-0 opacity-50 mask-[radial-gradient(ellipse_at_50%_50%,black,transparent_78%)]" />
          <div className="stage-aurora absolute -top-24 -left-16 size-72 rounded-full bg-series-1/25 blur-3xl" />
          <div className="stage-aurora absolute -right-20 -bottom-28 size-80 rounded-full bg-series-4/20 blur-3xl [animation-delay:-6s]" />
          <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/stage:opacity-100 bg-[radial-gradient(26rem_circle_at_var(--mx,50%)_var(--my,50%),var(--color-accent-soft),transparent_70%)]" />
        </div>
        <span
          aria-hidden="true"
          className="absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-accent-text to-transparent opacity-70"
        />

        <div className="flex items-center justify-between px-5 pt-4 sm:px-7 sm:pt-5">
          <span className="font-mono text-xs tracking-wider text-fg-secondary">
            {String(PILLARS.findIndex((pillar) => pillar.key === active) + 1).padStart(2, "0")} /{" "}
            {String(PILLARS.length).padStart(2, "0")}
          </span>
          <span aria-hidden="true" className="flex gap-1.5">
            {PILLARS.map(({ key }) => (
              <span
                key={key}
                className={cn(
                  "h-1 rounded-full transition-[width,background-color] duration-500",
                  key === active ? "w-6 bg-accent-text" : "w-1.5 bg-border-strong"
                )}
              />
            ))}
          </span>
        </div>

        <div className="px-5 pt-3 pb-6 sm:px-7 sm:pb-7">
          {PILLARS.map(({ key }) => (
            <TabsPrimitive.Content key={key} value={key} className="outline-none">
              <div className="flex min-h-64 items-center justify-center py-2">
                {key === "lineage" ? <LineageScene /> : null}
                {key === "holds" ? <HoldScene /> : null}
                {key === "recall" ? <RecallScene /> : null}
              </div>
              <p className="mt-3 text-center text-sm text-balance text-fg-secondary">
                {t(`pillars.${key}.caption`)}
              </p>
            </TabsPrimitive.Content>
          ))}
        </div>
      </div>
    </TabsPrimitive.Root>
  );
}

/**
 * Runs `build` against the scene's root once the scene mounts (a tab's content only exists while it
 * is open, so this is "every time the tab opens"). Everything GSAP creates is scoped to the root and
 * reverted on unmount. Reduced motion skips it, leaving the scene in its final state.
 */
function useSceneTimeline<T extends Element>(build: (root: T) => void, rebuildOn: unknown[] = []) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  const buildRef = useRef(build);

  useEffect(() => {
    buildRef.current = build;
  });

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    const scope = gsap.context(() => buildRef.current(root), root);
    return () => scope.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rebuildOn` is the caller's own list
  }, [reduced, ...rebuildOn]);

  return ref;
}

const NODE_WIDTH = 148;
const NODE_HEIGHT = 56;

/** One unit in a diagram. Colours are tokens, so both themes work; the shapes are decoration. */
function UnitNode({
  x,
  y,
  title,
  sub,
  accent = false,
}: {
  x: number;
  y: number;
  title: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <g data-node>
      <rect
        x={x}
        y={y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={14}
        className={cn("fill-surface", accent ? "stroke-accent-text" : "stroke-border-strong")}
        strokeWidth={accent ? 1.75 : 1}
        style={
          accent ? { filter: "drop-shadow(0 0 14px var(--color-accent-soft-border))" } : undefined
        }
      />
      <circle
        data-ring
        cx={x + 16}
        cy={y + 17}
        r={3.5}
        className={accent ? "fill-accent-text" : "fill-series-2"}
      />
      <text
        x={x + NODE_WIDTH / 2 + 6}
        y={y + 23}
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        className="fill-fg"
      >
        {title}
      </text>
      <text
        x={x + NODE_WIDTH / 2}
        y={y + 42}
        textAnchor="middle"
        fontSize="11"
        className="fill-fg-secondary"
      >
        {sub}
      </text>
    </g>
  );
}

/**
 * Two drawings of the same tree. Wide: the root over three children in a row. Narrow (phones): the
 * root with its children stacked below, joined by a rail on the left, so the labels keep their size
 * instead of shrinking with the drawing.
 */
const LAYOUTS = {
  wide: {
    viewBox: "0 0 560 210",
    root: { x: 206, y: 8 },
    children: [
      { x: 16, y: 132 },
      { x: 206, y: 132 },
      { x: 396, y: 132 },
    ],
    /** Connectors from the root to each child; each draws itself, then a packet rides it. */
    links: ["M280 64 V98 H90 V132", "M280 64 V132", "M280 64 V98 H470 V132"],
  },
  narrow: {
    viewBox: "0 0 300 292",
    root: { x: 76, y: 6 },
    children: [
      { x: 76, y: 90 },
      { x: 76, y: 160 },
      { x: 76, y: 230 },
    ],
    links: ["M76 34 H34 V118 H76", "M76 34 H34 V188 H76", "M76 34 H34 V258 H76"],
  },
} as const;
type LayoutKey = keyof typeof LAYOUTS;

function TreeLinks({
  links,
  tone = "accent",
}: {
  links: readonly string[];
  tone?: "accent" | "warning";
}) {
  const trace = tone === "warning" ? "stroke-warning-solid" : "stroke-accent-text";
  const packet = tone === "warning" ? "fill-warning-solid" : "fill-accent-text";
  const glow = tone === "warning" ? "var(--color-warning-solid)" : "var(--color-accent-text)";
  return (
    <>
      {links.map((d) => (
        <path
          key={`track-${d}`}
          d={d}
          fill="none"
          className="stroke-border-strong"
          strokeWidth={1.5}
        />
      ))}
      {links.map((d) => (
        <path
          key={`trace-${d}`}
          data-link
          d={d}
          fill="none"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={0}
          strokeLinecap="round"
          className={trace}
          strokeWidth={2}
        />
      ))}
      {links.map((d) => (
        <circle
          key={`packet-${d}`}
          data-packet
          r={4.5}
          className={packet}
          style={{ filter: `drop-shadow(0 0 6px ${glow})` }}
        />
      ))}
    </>
  );
}

/** Draws the tree: top node first, connectors tracing down, packets riding them, children landing. */
function playTree(root: SVGSVGElement, { wave = false }: { wave?: boolean } = {}) {
  const nodes = gsap.utils.toArray<SVGGElement>("[data-node]", root);
  const links = gsap.utils.toArray<SVGPathElement>("[data-link]", root);
  const packets = gsap.utils.toArray<SVGCircleElement>("[data-packet]", root);
  const [top, ...children] = nodes;
  if (!top) return;

  gsap.set(packets, { autoAlpha: 0 });
  gsap.set(links, { strokeDashoffset: 1 });

  const timeline = gsap.timeline({ defaults: { ease: EASE_OUT } });
  timeline
    .from(top, { autoAlpha: 0, y: -16, scale: 0.9, transformOrigin: "50% 50%", duration: 0.7 })
    .to(links, { strokeDashoffset: 0, duration: 0.9, stagger: 0.12, ease: "power2.inOut" }, 0.35)
    .from(
      children,
      {
        autoAlpha: 0,
        y: 22,
        scale: 0.88,
        transformOrigin: "50% 50%",
        duration: 0.7,
        stagger: 0.12,
        ease: "back.out(1.6)",
      },
      0.9
    );

  if (wave) {
    timeline.fromTo(
      children.map((child) => child.querySelector("rect")),
      { strokeWidth: 1 },
      { strokeWidth: 2.5, yoyo: true, repeat: 1, duration: 0.35, stagger: 0.14 },
      1.5
    );
  }

  const ride = gsap.timeline({ repeat: -1, repeatDelay: 1.1, delay: 1.6 });
  packets.forEach((packet, index) => {
    const path = links[index];
    if (!path) return;
    const start = index * 0.12;
    ride
      .set(packet, { autoAlpha: 1 }, start)
      .to(
        packet,
        {
          motionPath: { path, align: path, alignOrigin: [0.5, 0.5] },
          duration: 1.4,
          ease: "power1.inOut",
        },
        start
      )
      .to(packet, { autoAlpha: 0, duration: 0.25 }, start + 1.4);
  });
}

const NARROW_QUERY = "(max-width: 639px)";

function subscribeNarrow(onChange: () => void) {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Phones get the stacked drawing. The server renders the wide one; a phone swaps it on hydration. */
function useLayoutKey(): LayoutKey {
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
  return narrow ? "narrow" : "wide";
}

type TreeNode = { title: string; sub: string; accent?: boolean };

/** A root unit and three units derived from it, drawn for whichever layout fits the screen. */
function TreeScene({
  label,
  root,
  derived,
  tone,
  wave,
}: {
  label: string;
  root: TreeNode;
  derived: readonly [TreeNode, TreeNode, TreeNode];
  tone?: "accent" | "warning";
  wave?: boolean;
}) {
  const layout = LAYOUTS[useLayoutKey()];
  const ref = useSceneTimeline<SVGSVGElement>((svg) => playTree(svg, { wave }), [layout]);
  return (
    <svg
      key={layout.viewBox}
      ref={ref}
      viewBox={layout.viewBox}
      className="w-full max-w-xl overflow-visible"
      role="img"
      aria-label={label}
    >
      <TreeLinks links={layout.links} tone={tone} />
      <UnitNode {...layout.root} {...root} accent />
      {layout.children.map((position, index) => (
        <UnitNode key={position.y + position.x} {...position} {...derived[index]!} />
      ))}
    </svg>
  );
}

function LineageScene() {
  const t = useTranslations("marketing.platform");
  return (
    <TreeScene
      label={t("pillars.lineage.scene")}
      root={{ title: "SRC-014", sub: t("scenes.sourceLot") }}
      derived={[
        { title: "SMP-1048", sub: t("scenes.culture") },
        { title: "SMP-1042", sub: "12.4 g" },
        { title: "SMP-1051", sub: t("scenes.split") },
      ]}
    />
  );
}

function RecallScene() {
  const t = useTranslations("marketing.platform");
  return (
    <TreeScene
      label={t("pillars.recall.scene")}
      tone="warning"
      wave
      root={{ title: "SMP-1042", sub: t("scenes.source") }}
      derived={[
        { title: "SMP-1048", sub: t("scenes.coldRoomB") },
        { title: "SMP-1051", sub: t("scenes.vault") },
        { title: "SHP-88", sub: t("scenes.shipped"), accent: true },
      ]}
    />
  );
}

const HOLD_PLACED_BY = "A. Hassan";

function HoldScene() {
  const t = useTranslations("marketing.platform");
  const ref = useSceneTimeline<HTMLDivElement>((root) => {
    const q = gsap.utils.selector(root);
    gsap
      .timeline({ defaults: { ease: EASE_OUT } })
      .from(root, { autoAlpha: 0, y: 24, scale: 0.97, duration: 0.7 })
      .from(q("[data-row]"), { autoAlpha: 0, y: 10, duration: 0.45, stagger: 0.15 }, 0.5)
      .from(
        q("[data-badge]"),
        { scale: 0.4, autoAlpha: 0, duration: 0.55, ease: "back.out(2.4)" },
        1.1
      )
      .from(q("[data-lock]"), { rotate: -35, duration: 0.5, ease: "elastic.out(1,0.5)" }, 1.2)
      .from(q("[data-blocked]"), { y: 14, autoAlpha: 0, duration: 0.6 }, 1.45)
      .from(q("[data-blocked-icon]"), { scale: 0, duration: 0.45, ease: "back.out(3)" }, 1.6);
  });

  return (
    <div
      ref={ref}
      role="img"
      aria-label={t("pillars.holds.scene")}
      className="w-full max-w-md rounded-2xl border border-border-strong bg-bg/80 p-5 shadow-lg backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-accent-text">{SAMPLE_CODE}</span>
        <span
          data-badge
          className="inline-flex items-center gap-1.5 rounded-full border border-warning-soft-border bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning"
        >
          <Lock data-lock aria-hidden="true" className="size-3" />
          {t("scenes.held")}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium">{t("scenes.holdTitle")}</p>

      <dl className="mt-4 space-y-2 text-sm">
        <div data-row className="flex justify-between gap-4">
          <dt className="text-xs text-fg-secondary">{t("scenes.holdKind")}</dt>
          <dd>{t("scenes.holdKindValue")}</dd>
        </div>
        <div data-row className="flex justify-between gap-4">
          <dt className="text-xs text-fg-secondary">{t("scenes.holdBy")}</dt>
          <dd>{HOLD_PLACED_BY}</dd>
        </div>
        <div data-row className="flex justify-between gap-4">
          <dt className="text-xs text-fg-secondary">{t("scenes.holdReason")}</dt>
          <dd className="text-end">{t("scenes.holdReasonValue")}</dd>
        </div>
      </dl>
      <p
        data-blocked
        className="mt-5 flex items-center gap-2 rounded-lg border border-danger-soft-border bg-danger-soft px-3 py-2 text-xs text-danger"
      >
        <Lock data-blocked-icon aria-hidden="true" className="size-3.5 shrink-0" />
        {t("scenes.blocked")}
      </p>
    </div>
  );
}
