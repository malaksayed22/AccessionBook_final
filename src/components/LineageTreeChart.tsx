"use client";

import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { cladeOf, layoutPhylo, type PhyloLayout } from "@/lib/phylo-layout";
import { cn } from "@/lib/utils";

export type TreeTone = "active" | "hold" | "inactive" | "destroyed";

export type TreeUnit = {
  id: number;
  parentId: number | null;
  name: string;
  tone: TreeTone;
  /** Where the name leads, without the language prefix. */
  href: string;
};

type Labels = {
  title: string;
  rectangular: string;
  circular: string;
  forward: string;
  earliest: string;
  latest: string;
  legend: Record<TreeTone | "traced" | "clade", string>;
};

/** The traced unit's clade: one hue for its branches and names, as tree viewers colour a clade. */
const CLADE = "var(--color-series-1)";
const BRANCH = "var(--color-fg-secondary)";

const TONE_FILL: Record<TreeTone, string> = {
  active: "var(--color-success-solid)",
  hold: "var(--color-warning-solid)",
  inactive: "var(--color-fg-tertiary)",
  destroyed: "var(--color-danger-solid)",
};

/* Rectangular: one tip per row, one generation per step, a stem from the left, an arrow below. */
const ROW = 30;
const STEP = 120;
const STEM = 36;
const PAD = 16;
const LABEL_ROOM = 190;
const ARROW = 70;

/* Circular: the forks on rings, the tips on the outside ring, the names around it. */
const RING = 70;
const CORE = 30;
const OUTER_ROOM = 160;

type Tree = {
  layout: PhyloLayout<TreeUnit>;
  clade: Set<number>;
  tracedId: number;
  link: (href: string) => string;
};

/**
 * The lineage as a phylogenetic tree, drawn like one: every unit is a tip, the tips line up on the
 * right (or around the outside), and the branch points are plain forks. A unit with offspring is a
 * fork whose first tip is the unit itself. The traced unit and everything derived from it are drawn
 * in their own colour; a small dot at each tip gives the unit's status, and its name leads to it.
 * Rectangular (the mother line on the left, forward in time to the right) or circular.
 */
export function LineageTreeChart({
  units,
  tracedId,
  labels,
}: {
  units: TreeUnit[];
  tracedId: number;
  labels: Labels;
}) {
  const locale = useLocale();
  const [shape, setShape] = useState<"rectangular" | "circular">("rectangular");
  const layout = useMemo(
    () => layoutPhylo(units.map((u) => ({ id: u.id, parentId: u.parentId, item: u }))),
    [units]
  );
  const clade = useMemo(() => cladeOf(layout, tracedId), [layout, tracedId]);
  const tree: Tree = { layout, clade, tracedId, link: (href) => `/${locale}${href}` };

  return (
    <figure className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <figcaption className="text-sm font-semibold text-fg">{labels.title}</figcaption>
        <div
          role="radiogroup"
          aria-label={labels.title}
          className="flex gap-1 rounded-lg bg-sunken p-1"
        >
          {(["rectangular", "circular"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={shape === value}
              onClick={() => setShape(value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-focus",
                shape === value ? "bg-surface text-fg shadow-sm" : "text-fg-secondary hover:text-fg"
              )}
            >
              {labels[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto p-3">
        {shape === "rectangular" ? (
          <Rectangular {...tree} labels={labels} />
        ) : (
          <Circular {...tree} />
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-4 py-3 text-xs text-fg-secondary">
        {(["active", "hold", "inactive", "destroyed"] as const).map((tone) => (
          <li key={tone} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: TONE_FILL[tone] }}
            />
            {labels.legend[tone]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-5 rounded" style={{ background: CLADE }} />
          {labels.legend.clade}
        </li>
      </ul>
    </figure>
  );
}

function TipName({
  x,
  y,
  name,
  inClade,
  traced,
  href,
  anchor = "start",
  rotate,
}: {
  x: number;
  y: number;
  name: string;
  inClade: boolean;
  traced: boolean;
  href: string;
  anchor?: "start" | "end";
  rotate?: number;
}) {
  return (
    <a href={href}>
      <text
        x={x}
        y={y}
        dominantBaseline="middle"
        textAnchor={anchor}
        transform={rotate === undefined ? undefined : `rotate(${rotate} ${x} ${y})`}
        className={cn("text-[12.5px] hover:underline", !inClade && "fill-fg")}
        fill={inClade ? CLADE : undefined}
        fontWeight={traced ? 700 : 400}
      >
        {name}
      </text>
    </a>
  );
}

function Rectangular({ layout, clade, tracedId, link, labels }: Tree & { labels: Labels }) {
  const tipX = PAD + STEM + layout.depth * STEP;
  const width = tipX + LABEL_ROOM;
  const height = layout.rows * ROW + ARROW;
  const y = (row: number) => row * ROW + ROW / 2;
  const forkX = (depth: number) => PAD + STEM + depth * STEP;
  const forkOf = new Map(layout.forks.map((f) => [f.unitId, f]));
  const tipOf = new Map(layout.tips.map((t) => [t.id, t]));
  const where = (child: { kind: "tip" | "fork"; id: number }) => {
    if (child.kind === "fork") {
      const fork = forkOf.get(child.id)!;
      return { x: forkX(fork.depth), y: y(fork.row) };
    }
    return { x: tipX, y: y(tipOf.get(child.id)!.row) };
  };
  const colour = (id: number) => (clade.has(id) ? CLADE : BRANCH);
  const stroke = (id: number) => (clade.has(id) ? 2.25 : 1.5);
  const arrowY = layout.rows * ROW + 12;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {/* The stem into each root, from the left. */}
      {layout.roots.map((root) => {
        const to = where(root);
        return (
          <path
            key={`stem-${root.id}`}
            d={`M ${PAD} ${to.y} H ${to.x}`}
            stroke={colour(root.id)}
            strokeWidth={stroke(root.id)}
            fill="none"
          />
        );
      })}
      {/* Each fork: a bar down to its children, then across to each one. */}
      {layout.forks.flatMap((fork) => {
        const from = { x: forkX(fork.depth), y: y(fork.row) };
        return fork.children.map((child) => {
          const to = where(child);
          return (
            <path
              key={`edge-${fork.unitId}-${child.kind}-${child.id}`}
              d={`M ${from.x} ${from.y} V ${to.y} H ${to.x}`}
              stroke={colour(child.id)}
              strokeWidth={stroke(child.id)}
              strokeLinecap="square"
              fill="none"
            />
          );
        });
      })}
      {/* The tips: a status dot and the name. */}
      {layout.tips.map((tip) => (
        <g key={`tip-${tip.id}`}>
          <circle cx={tipX + 6} cy={y(tip.row)} r={3.5} fill={TONE_FILL[tip.item.tone]} />
          <TipName
            x={tipX + 15}
            y={y(tip.row)}
            name={tip.item.name}
            inClade={clade.has(tip.id)}
            traced={tip.id === tracedId}
            href={link(tip.item.href)}
          />
        </g>
      ))}
      {/* Forward in time: from the mother line to the latest units. */}
      <path
        d={`M ${PAD + 40} ${arrowY} H ${tipX - 14} V ${arrowY - 6} L ${tipX + 4} ${arrowY + 8} L ${tipX - 14} ${arrowY + 22} V ${arrowY + 16} H ${PAD + 40} Z`}
        fill="var(--color-sunken)"
        stroke="var(--color-border-strong)"
      />
      <text
        x={(PAD + 40 + tipX) / 2}
        y={arrowY + 8}
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-fg-secondary text-[11px]"
      >
        {labels.forward}
      </text>
      <text x={PAD} y={arrowY + 40} className="fill-fg-secondary text-[12px]">
        {labels.earliest}
      </text>
      <text
        x={tipX + 4}
        y={arrowY + 40}
        textAnchor="middle"
        className="fill-fg-secondary text-[12px]"
      >
        {labels.latest}
      </text>
    </svg>
  );
}

function Circular({ layout, clade, tracedId, link }: Tree) {
  const tipR = CORE + layout.depth * RING;
  const size = (tipR + OUTER_ROOM) * 2;
  const c = size / 2;
  // The tips share an arc, about 24 degrees each: a fan for a small family, a ring for a large one.
  const span = Math.min(Math.PI * 2 * 0.96, Math.max(layout.rows - 1, 0) * ((Math.PI * 2) / 15));
  const angle = (row: number) =>
    layout.rows === 1 ? -Math.PI / 2 : -Math.PI / 2 - span / 2 + (row / (layout.rows - 1)) * span;
  const forkR = (depth: number) => CORE + depth * RING;
  const point = (r: number, a: number) => ({ x: c + r * Math.cos(a), y: c + r * Math.sin(a) });
  const forkOf = new Map(layout.forks.map((f) => [f.unitId, f]));
  const tipOf = new Map(layout.tips.map((t) => [t.id, t]));
  const polar = (child: { kind: "tip" | "fork"; id: number }) => {
    if (child.kind === "fork") {
      const fork = forkOf.get(child.id)!;
      return { r: forkR(fork.depth), a: angle(fork.row) };
    }
    return { r: tipR, a: angle(tipOf.get(child.id)!.row) };
  };
  const colour = (id: number) => (clade.has(id) ? CLADE : BRANCH);
  const stroke = (id: number) => (clade.has(id) ? 2.25 : 1.5);
  // Only the part of the circle the tree uses: a fan does not leave the rest of the disc empty.
  const reach = layout.tips.map((tip) => point(tipR + OUTER_ROOM, angle(tip.row)));
  const xs = [c, ...reach.map((p) => p.x)];
  const ys = [c, ...reach.map((p) => p.y)];
  const box = {
    x: Math.max(Math.min(...xs) - 12, 0),
    y: Math.max(Math.min(...ys) - 12, 0),
    w: 0,
    h: 0,
  };
  box.w = Math.min(Math.max(...xs) + 12, size) - box.x;
  box.h = Math.min(Math.max(...ys) + 24, size) - box.y;

  return (
    <svg
      width={box.w}
      height={box.h}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className="mx-auto block"
      aria-hidden="true"
    >
      {layout.roots.map((root) => {
        const to = polar(root);
        const end = point(to.r, to.a);
        return (
          <path
            key={`stem-${root.id}`}
            d={`M ${c} ${c} L ${end.x} ${end.y}`}
            stroke={colour(root.id)}
            strokeWidth={stroke(root.id)}
            fill="none"
          />
        );
      })}
      {layout.forks.flatMap((fork) => {
        const rp = forkR(fork.depth);
        const ap = angle(fork.row);
        const start = point(rp, ap);
        return fork.children.map((child) => {
          const to = polar(child);
          const turn = point(rp, to.a);
          const end = point(to.r, to.a);
          const sweep = to.a > ap ? 1 : 0;
          const large = Math.abs(to.a - ap) > Math.PI ? 1 : 0;
          return (
            <path
              key={`edge-${fork.unitId}-${child.kind}-${child.id}`}
              d={`M ${start.x} ${start.y} A ${rp} ${rp} 0 ${large} ${sweep} ${turn.x} ${turn.y} L ${end.x} ${end.y}`}
              stroke={colour(child.id)}
              strokeWidth={stroke(child.id)}
              fill="none"
            />
          );
        });
      })}
      {layout.tips.map((tip) => {
        const a = angle(tip.row);
        const dot = point(tipR + 6, a);
        const at = point(tipR + 15, a);
        const left = Math.cos(a) < -1e-9;
        const degrees = (a * 180) / Math.PI;
        return (
          <g key={`tip-${tip.id}`}>
            <circle cx={dot.x} cy={dot.y} r={3.5} fill={TONE_FILL[tip.item.tone]} />
            <TipName
              x={at.x}
              y={at.y}
              name={tip.item.name}
              inClade={clade.has(tip.id)}
              traced={tip.id === tracedId}
              href={link(tip.item.href)}
              anchor={left ? "end" : "start"}
              rotate={left ? degrees + 180 : degrees}
            />
          </g>
        );
      })}
    </svg>
  );
}
