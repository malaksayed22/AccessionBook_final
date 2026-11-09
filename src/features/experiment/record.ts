import "server-only";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { joined, RECORD_ROW_LIMIT, recordContext, type RecordFile } from "@/features/record/common";
import type { AppLocale } from "@/i18n/routing";
import type { SessionUser } from "@/lib/auth";
import type { PdfBlock, PdfSection } from "@/lib/pdf/record-pdf";
import { unitStatusOf } from "@/lib/unit-profile";
import { unitReadScope } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { getExperimentDetail } from "./queries";
import { isEmptied, NO_STOCK_KINDS } from "@/lib/stock-kinds";
import { LAB_RESULTS_SHOWN } from "@/lib/lab-results";

const toNumber = (value: { toString(): string } | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value);

/** What the experiment's units hold, shipped, lost in drying and had destroyed, in grams and seeds. */
async function loadQuantities(user: SessionUser, experimentId: number) {
  const scoped: Prisma.BiologicalUnitWhereInput = { AND: [unitReadScope(user), { experimentId }] };
  const ofExperiment = { unit: { is: scoped } } satisfies Prisma.UnitStateWhereInput;
  const current = (kind: Prisma.EnumUnitStateKindFilter) =>
    prisma.unitState.aggregate({
      where: { kind, currentOf: { is: scoped } },
      _sum: { humidWeight: true, dryWeight: true, seedCount: true },
      _count: { _all: true, humidWeight: true, dryWeight: true, seedCount: true },
    });
  const inStock: Prisma.EnumUnitStateKindFilter = { notIn: [...NO_STOCK_KINDS] };
  const [stock, uncountedSeedLots, destroyed, shipped, drying, waste] = await Promise.all([
    current(inStock),
    prisma.biologicalUnit.count({
      where: {
        AND: [
          scoped,
          { type: "SEEDLOT", currentState: { is: { kind: inStock, seedCount: null } } },
        ],
      },
    }),
    current({ equals: "DESTROYED" }),
    prisma.unitState.groupBy({
      by: ["shippedMoisture"],
      where: { ...ofExperiment, kind: { in: ["SHIPPED_PART", "SHIPPED"] } },
      _sum: { shippedWeight: true, shippedCount: true },
      _count: { _all: true },
    }),
    // Per unit, the first event with a dry weight, and the wet weight it had then. The experiment is
    // readable, so all its units are (as for the location counts of the experiment page).
    prisma.$queryRaw<Array<{ wet: Prisma.Decimal; dry: Prisma.Decimal; units: bigint }>>`
      SELECT COALESCE(SUM(f."humidWeight"), 0) AS "wet", COALESCE(SUM(f."dryWeight"), 0) AS "dry",
        count(*) AS "units"
      FROM (
        SELECT DISTINCT ON (s."unitId") s."humidWeight", s."dryWeight"
        FROM "UnitState" s
        JOIN "BiologicalUnit" u ON u."id" = s."unitId"
        WHERE u."experimentId" = ${experimentId} AND s."dryWeight" IS NOT NULL
        ORDER BY s."unitId", s."sequence"
      ) f
      WHERE f."humidWeight" IS NOT NULL AND f."humidWeight" >= f."dryWeight"`,
    prisma.unitState.groupBy({
      by: ["shippedMoisture"],
      where: { ...ofExperiment, kind: "WASTED" },
      _sum: { shippedWeight: true },
      _count: { _all: true },
    }),
  ]);
  const shippedBy = (moisture: "WET" | "DRY" | null) =>
    shipped.find((row) => row.shippedMoisture === moisture);
  const dried = drying[0];
  return {
    // A measure no unit in stock has recorded is unknown, not zero.
    stock: {
      wet: stock._count.humidWeight ? toNumber(stock._sum.humidWeight) : null,
      dry: stock._count.dryWeight ? toNumber(stock._sum.dryWeight) : null,
      seeds: stock._count.seedCount ? (stock._sum.seedCount ?? 0) : null,
      uncountedSeedLots,
    },
    waste: {
      entries: waste.reduce((sum, row) => sum + row._count._all, 0),
      wet: toNumber(waste.find((row) => row.shippedMoisture === "WET")?._sum.shippedWeight),
      dry: toNumber(waste.find((row) => row.shippedMoisture === "DRY")?._sum.shippedWeight),
    },
    destroyed: {
      units: destroyed._count._all,
      wet: toNumber(destroyed._sum.humidWeight),
      dry: toNumber(destroyed._sum.dryWeight),
      seeds: destroyed._sum.seedCount ?? 0,
    },
    shipped: {
      shipments: shipped.reduce((sum, row) => sum + row._count._all, 0),
      wet: toNumber(shippedBy("WET")?._sum.shippedWeight),
      dry: toNumber(shippedBy("DRY")?._sum.shippedWeight),
      seeds: shipped.reduce((sum, row) => sum + (row._sum.shippedCount ?? 0), 0),
    },
    drying:
      dried && Number(dried.units) > 0
        ? {
            wet: toNumber(dried.wet),
            dry: toNumber(dried.dry),
            loss: Math.round((toNumber(dried.wet) - toNumber(dried.dry)) * 1000) / 1000,
          }
        : null,
  };
}

/**
 * An experiment's record for an inspector, the batch record of a seed-to-sale system: its details,
 * unit counts, quantities, phases with their days, where the units are and came from, every unit,
 * and the lab results, shipments, destructions and incidents of its units. Null when the experiment
 * does not exist or is outside the user's scope, exactly like its page.
 */
export async function buildExperimentRecord(
  user: SessionUser,
  experimentId: number,
  locale: AppLocale
): Promise<RecordFile | null> {
  const detail = await getExperimentDetail(user, experimentId);
  if (!detail) return null;

  const scoped: Prisma.BiologicalUnitWhereInput = { AND: [unitReadScope(user), { experimentId }] };
  const ofExperiment = { unit: { is: scoped } } satisfies Prisma.UnitStateWhereInput;
  const [
    quantities,
    units,
    tests,
    testCount,
    shipments,
    shipmentCount,
    destructions,
    destructionCount,
    incidents,
    activities,
    activityCount,
  ] = await Promise.all([
    loadQuantities(user, experimentId),
    prisma.biologicalUnit.findMany({
      where: scoped,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: RECORD_ROW_LIMIT,
      select: {
        name: true,
        type: true,
        cultivar: { select: { name: true } },
        holds: { where: { releasedAt: null }, select: { kind: true }, take: 1 },
        currentState: {
          select: {
            kind: true,
            growthStage: true,
            humidWeight: true,
            dryWeight: true,
            seedCount: true,
            location: { select: { name: true } },
          },
        },
      },
    }),
    prisma.labTest.findMany({
      where: { voidedAt: null, unit: { is: scoped } },
      orderBy: [{ testedAt: "asc" }, { id: "asc" }],
      take: RECORD_ROW_LIMIT,
      select: {
        testedAt: true,
        panel: true,
        analyte: true,
        value: true,
        uom: true,
        wetWeight: true,
        dryWeight: true,
        labName: true,
        unit: { select: { name: true } },
      },
    }),
    prisma.labTest.count({ where: { voidedAt: null, unit: { is: scoped } } }),
    prisma.unitState.findMany({
      where: { ...ofExperiment, kind: { in: ["SHIPPED_PART", "SHIPPED"] } },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      take: RECORD_ROW_LIMIT,
      select: {
        effectiveAt: true,
        shippedWeight: true,
        shippedMoisture: true,
        shippedCount: true,
        unit: { select: { name: true } },
        organization: { select: { name: true } },
        recordedBy: { select: { name: true } },
        shipmentItem: { select: { shipment: { select: { reference: true } } } },
      },
    }),
    prisma.unitState.count({
      where: { ...ofExperiment, kind: { in: ["SHIPPED_PART", "SHIPPED"] } },
    }),
    prisma.unitState.findMany({
      where: { ...ofExperiment, kind: "DESTROYED" },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      take: RECORD_ROW_LIMIT,
      select: {
        effectiveAt: true,
        reason: true,
        humidWeight: true,
        dryWeight: true,
        seedCount: true,
        unit: { select: { name: true } },
        recordedBy: { select: { name: true } },
      },
    }),
    prisma.unitState.count({ where: { ...ofExperiment, kind: "DESTROYED" } }),
    prisma.qualityIncident.findMany({
      where: { voidedAt: null, OR: [{ experimentId }, { unit: { is: scoped } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: RECORD_ROW_LIMIT,
      select: {
        createdAt: true,
        severity: true,
        status: true,
        title: true,
        description: true,
        resolution: true,
        unit: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.unitActivity.findMany({
      where: { unit: { is: scoped } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: RECORD_ROW_LIMIT,
      select: {
        date: true,
        type: true,
        title: true,
        details: true,
        product: true,
        pcpNumber: true,
        amount: true,
        amountUnit: true,
        method: true,
        unit: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.unitActivity.count({ where: { unit: { is: scoped } } }),
  ]);

  const ctx = await recordContext(locale, user);
  const t = await getTranslations({ locale, namespace: "recordPdf.experiment" });
  const { domain, empty, when, day, grams, count, number, percent, table } = ctx;
  const amounts = (wet: number, dry: number, seeds: number) =>
    joined(
      [
        wet ? ctx.t("wetValue", { value: grams(wet) }) : null,
        dry ? ctx.t("dryValue", { value: grams(dry) }) : null,
        seeds ? ctx.t("seeds", { count: seeds }) : null,
      ],
      ctx.t("nothing")
    );
  const optionalGrams = (value: { toString(): string } | null) =>
    value === null ? "" : grams(Number(value));

  // --- Details ---
  const lead = detail.members.filter((member) => member.role === "LEAD");
  const others = detail.members.filter((member) => member.role !== "LEAD");
  const fields = [
    { label: t("fields.code"), value: detail.ecode },
    { label: t("fields.name"), value: detail.name },
    { label: t("fields.status"), value: domain(`experimentStatus.${detail.status}`) },
    { label: t("fields.started"), value: day(detail.startDate) },
    detail.endDate
      ? { label: t("fields.completed"), value: day(detail.endDate) }
      : {
          label: t("fields.estimatedEnd"),
          value: detail.estimatedEndDate ? day(detail.estimatedEndDate) : empty,
        },
    {
      label: t("fields.parent"),
      value: detail.parent ? `${detail.parent.ecode} · ${detail.parent.name}` : empty,
    },
    { label: t("fields.sourceUnit"), value: detail.sourceUnit?.name ?? empty },
    { label: t("fields.lead"), value: lead.map((member) => member.name).join(", ") || empty },
    { label: t("fields.members"), value: others.map((member) => member.name).join(", ") || empty },
  ];
  const details: PdfBlock[] = [{ kind: "fields", fields }];
  if (detail.comment) {
    details.push({
      kind: "fields",
      fields: [{ label: t("fields.comment"), value: detail.comment }],
    });
  }

  // --- Counts and quantities ---
  const counts: PdfBlock = {
    kind: "figures",
    figures: [
      { label: t("figures.total"), value: count(detail.counts.total) },
      { label: t("figures.active"), value: count(detail.counts.active) },
      { label: t("figures.onHold"), value: count(detail.counts.onHold) },
      { label: t("figures.nothingLeft"), value: count(detail.counts.nothingLeft) },
      { label: t("figures.destroyed"), value: count(detail.counts.destroyed) },
    ],
  };
  const groups = table(
    [
      { header: t("columns.type"), width: 2 },
      { header: t("columns.cultivar"), width: 3 },
      { header: t("columns.registered"), width: 1.4, align: "end" },
      { header: t("columns.inStock"), width: 1.4, align: "end" },
    ],
    detail.groups.map((group) => [
      domain(`unitType.${group.type}`),
      group.cultivarName ?? empty,
      count(group.total),
      count(group.inventory),
    ])
  );
  const figures = [
    { label: t("figures.wet"), value: grams(quantities.stock.wet) },
    { label: t("figures.dry"), value: grams(quantities.stock.dry) },
    {
      label: t("figures.seeds"),
      value: count(quantities.stock.seeds),
      note: quantities.stock.uncountedSeedLots
        ? t("figures.uncounted", { count: quantities.stock.uncountedSeedLots })
        : undefined,
    },
    {
      label: t("figures.shipped"),
      value: amounts(quantities.shipped.wet, quantities.shipped.dry, quantities.shipped.seeds),
      note: ctx.t("shipments", { count: quantities.shipped.shipments }),
    },
    ...(quantities.drying
      ? [
          {
            label: t("figures.drying"),
            value: grams(quantities.drying.loss),
            note: `${t("figures.dryingNote", {
              wet: grams(quantities.drying.wet),
              dry: grams(quantities.drying.dry),
            })} (${ctx.t("share", {
              share: percent(
                quantities.drying.wet > 0 ? quantities.drying.loss / quantities.drying.wet : 0
              ),
            })})`,
          },
        ]
      : []),
    ...(quantities.waste.entries > 0
      ? [
          {
            label: t("figures.waste"),
            value: amounts(quantities.waste.wet, quantities.waste.dry, 0),
            note: t("figures.wasteNote", { count: quantities.waste.entries }),
          },
        ]
      : []),
    {
      label: t("figures.destroyedAmount"),
      value: t("figures.units", { count: quantities.destroyed.units }),
      note:
        quantities.destroyed.wet || quantities.destroyed.dry || quantities.destroyed.seeds
          ? amounts(quantities.destroyed.wet, quantities.destroyed.dry, quantities.destroyed.seeds)
          : undefined,
    },
  ];

  // --- Phases, places, origin ---
  const phases = table(
    [
      { header: t("columns.stage"), width: 3 },
      { header: t("columns.started"), width: 2 },
      { header: t("columns.ended"), width: 2 },
      { header: t("columns.days"), width: 1, align: "end" },
    ],
    detail.timeline.flatMap((span) =>
      span.stage === "NONE"
        ? []
        : [
            [
              domain(`growthStage.${span.stage}`),
              day(span.started),
              span.ended ? day(span.ended) : ctx.t("ongoing"),
              count(span.days),
            ],
          ]
    )
  );
  const locations = table(
    [
      { header: t("columns.location"), width: 5 },
      { header: t("columns.units"), width: 1.4, align: "end" },
    ],
    detail.locations.map((location) => [location.name, count(location.count)])
  );
  const provenance = table(
    [
      { header: t("columns.source"), width: 2 },
      { header: t("columns.provider"), width: 2.6 },
      { header: t("columns.description"), width: 3.4 },
      { header: t("columns.units"), width: 1.2, align: "end" },
    ],
    detail.provenance.map((row) => [
      row.sourceType ? domain(`sourceType.${row.sourceType}`) : empty,
      row.provider?.name ?? empty,
      row.description ?? empty,
      count(row.units),
    ])
  );
  const receipts = detail.receipts.length
    ? [
        { kind: "text" as const, text: t("receipts") },
        ...table(
          [
            { header: t("columns.receipt"), width: 2 },
            { header: t("columns.from"), width: 3 },
            { header: t("columns.delivered"), width: 2 },
            { header: t("columns.status"), width: 1.6 },
            { header: t("columns.lines"), width: 1, align: "end" },
          ],
          detail.receipts.map((receipt) => [
            receipt.reference,
            receipt.organization.name,
            receipt.deliveredDate ? day(receipt.deliveredDate) : empty,
            domain(`shipmentStatus.${receipt.status}`),
            count(receipt.lines),
          ])
        ),
      ]
    : [];

  // --- Units and what happened to them ---
  const unitRows = table(
    [
      { header: t("columns.unit"), width: 2.6 },
      { header: t("columns.type"), width: 1.3 },
      { header: t("columns.cultivar"), width: 1.8 },
      { header: t("columns.stage"), width: 1.4 },
      { header: t("columns.location"), width: 1.8 },
      { header: t("columns.status"), width: 1.4 },
      { header: t("columns.wet"), width: 1.1, align: "end" },
      { header: t("columns.dry"), width: 1.1, align: "end" },
      { header: t("columns.seeds"), width: 1, align: "end" },
    ],
    units.map((unit) => {
      const state = unit.currentState;
      const status = unitStatusOf(state?.kind, unit.holds[0]?.kind ?? null);
      return [
        unit.name,
        domain(`unitType.${unit.type}`),
        unit.cultivar?.name ?? empty,
        state?.growthStage ? domain(`growthStage.${state.growthStage}`) : empty,
        state?.location?.name ?? empty,
        isEmptied(state?.kind) && status === "active"
          ? domain("unitStatus.nothingLeft")
          : domain(`unitStatus.${status}`),
        state?.humidWeight != null ? number(Number(state.humidWeight)) : "",
        state?.dryWeight != null ? number(Number(state.dryWeight)) : "",
        state?.seedCount != null ? count(state.seedCount) : "",
      ];
    }),
    { more: detail.counts.total - units.length }
  );
  const testRows = table(
    [
      { header: t("columns.date"), width: 1.5 },
      { header: t("columns.unit"), width: 2.4 },
      { header: t("columns.test"), width: 2 },
      { header: t("columns.result"), width: 2.8 },
      { header: t("columns.lab"), width: 1.8 },
    ],
    tests.map((test) => [
      day(test.testedAt),
      test.unit?.name ?? empty,
      joined([domain(`testPanel.${test.panel}`), test.analyte], empty),
      joined(
        [
          test.value !== null ? `${number(test.value)}${test.uom ? ` ${test.uom}` : ""}` : null,
          test.wetWeight !== null ? ctx.t("wetValue", { value: grams(test.wetWeight) }) : null,
          test.dryWeight !== null ? ctx.t("dryValue", { value: grams(test.dryWeight) }) : null,
        ],
        empty
      ),
      test.labName ?? empty,
    ]),
    { more: testCount - tests.length }
  );
  const shipmentRows = table(
    [
      { header: t("columns.date"), width: 1.8 },
      { header: t("columns.unit"), width: 2.4 },
      { header: t("columns.to"), width: 2.6 },
      { header: t("columns.quantity"), width: 1.8 },
      { header: t("columns.by"), width: 1.6 },
    ],
    shipments.map((state) => [
      when(state.effectiveAt),
      state.unit.name,
      joined([state.organization?.name, state.shipmentItem?.shipment.reference], empty),
      state.shippedCount !== null
        ? ctx.t("seeds", { count: state.shippedCount })
        : state.shippedWeight !== null
          ? ctx.t(state.shippedMoisture === "DRY" ? "dryValue" : "wetValue", {
              value: optionalGrams(state.shippedWeight),
            })
          : empty,
      state.recordedBy.name,
    ]),
    { more: shipmentCount - shipments.length }
  );
  const destructionRows = table(
    [
      { header: t("columns.date"), width: 1.8 },
      { header: t("columns.unit"), width: 2.4 },
      { header: t("columns.reason"), width: 2.8 },
      { header: t("columns.quantity"), width: 2 },
      { header: t("columns.by"), width: 1.6 },
    ],
    destructions.map((state) => [
      when(state.effectiveAt),
      state.unit.name,
      state.reason ?? empty,
      amounts(toNumber(state.humidWeight), toNumber(state.dryWeight), state.seedCount ?? 0),
      state.recordedBy.name,
    ]),
    { more: destructionCount - destructions.length }
  );
  const incidentRows = table(
    [
      { header: t("columns.opened"), width: 2.4 },
      { header: t("columns.unit"), width: 2 },
      { header: t("columns.severity"), width: 1.2 },
      { header: t("columns.incident"), width: 4 },
      { header: t("columns.status"), width: 1.4 },
    ],
    incidents.map((incident) => [
      `${when(incident.createdAt)} · ${incident.user.name}`,
      incident.unit?.name ?? empty,
      domain(`incidentSeverity.${incident.severity}`),
      joined([`${incident.title}: ${incident.description}`, incident.resolution], empty),
      domain(`incidentStatus.${incident.status}`),
    ])
  );
  const activityRows = table(
    [
      { header: t("columns.date"), width: 1.8 },
      { header: t("columns.unit"), width: 2 },
      { header: t("columns.type"), width: 1.5 },
      { header: t("columns.details"), width: 3.6 },
      { header: t("columns.by"), width: 1.5 },
    ],
    activities.map((activity) => [
      when(activity.date),
      activity.unit.name,
      domain(`activityType.${activity.type}`),
      ctx.activityText({
        ...activity,
        amount: activity.amount === null ? null : Number(activity.amount),
      }),
      activity.user.name,
    ]),
    { more: activityCount - activities.length }
  );
  const documents = table(
    [
      { header: t("columns.document"), width: 5 },
      { header: t("columns.added"), width: 3 },
    ],
    [...detail.documents]
      .reverse()
      .map((document) => [
        `${document.label} (${document.fileName})`,
        `${when(document.createdAt)} · ${document.userName}`,
      ])
  );

  const sections: PdfSection[] = [
    { title: t("sections.details"), blocks: details },
    { title: t("sections.counts"), blocks: [counts, ...groups] },
    {
      title: t("sections.quantities"),
      blocks: [
        { kind: "figures", figures },
        { kind: "text", text: t("quantitiesNote"), muted: true },
      ],
    },
    {
      title: t("sections.phases"),
      blocks: [...phases, { kind: "text", text: t("phasesNote"), muted: true }],
    },
    { title: t("sections.locations"), blocks: locations },
    { title: t("sections.origin"), blocks: [...provenance, ...receipts] },
    { title: t("sections.units"), blocks: unitRows },
    ...(LAB_RESULTS_SHOWN ? [{ title: t("sections.tests"), blocks: testRows }] : []),
    { title: t("sections.shipments"), blocks: shipmentRows },
    { title: t("sections.destructions"), blocks: destructionRows },
    { title: t("sections.incidents"), blocks: incidentRows },
    { title: t("sections.activities"), blocks: activityRows },
    { title: t("sections.documents"), blocks: documents },
  ];

  return {
    record: ctx.record({
      title: t("title"),
      subject: `${detail.ecode} · ${detail.name}`,
      subtitle: detail.endDate
        ? t("subtitleCompleted", { start: day(detail.startDate), end: day(detail.endDate) })
        : t("subtitleRunning", { date: day(detail.startDate) }),
      qrUrl: `${env().APP_URL.replace(/\/$/, "")}/inventory/experiments/${detail.id}`,
      sections,
    }),
    filename: ctx.filename("experiment-record", detail.ecode),
  };
}
