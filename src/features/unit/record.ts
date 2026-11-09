import "server-only";
import { getTranslations } from "next-intl/server";
import { joined, recordContext, type RecordFile } from "@/features/record/common";
import type { AppLocale } from "@/i18n/routing";
import type { SessionUser } from "@/lib/auth";
import type { LifecycleStageId } from "@/lib/lifecycle-stages";
import type { PdfBlock, PdfSection } from "@/lib/pdf/record-pdf";
import { getUnitProfileUrl } from "@/lib/unit-codes";
import { summarizeUnitQuantities } from "@/lib/unit-quantities";
import { env } from "@/server/env";
import {
  getUnitDocuments,
  getUnitLedger,
  getUnitProfile,
  getUnitQuality,
  getUnitStates,
  type UnitStateRow,
} from "./detail-queries";
import { LAB_RESULTS_SHOWN } from "@/lib/lab-results";

const SEXES = ["MALE", "FEMALE", "HERMAPHRODITE"] as const;
/** An event filed this long after the moment it records says when it was filed. */
const FILED_LATE_MS = 60 * 60 * 1000;

/**
 * One unit's record for an inspector, like the batch record of a seed-to-sale system: its details,
 * quantities (now, shipped, destroyed, lost in drying), phases with their days, locations, lineage,
 * quality, field records and every event, oldest first. Null when the unit does not exist or is
 * outside the user's scope, exactly like the unit page.
 */
export async function buildUnitRecord(
  user: SessionUser,
  unitId: number,
  locale: AppLocale
): Promise<RecordFile | null> {
  const profile = await getUnitProfile(user, unitId);
  if (!profile) return null;
  const [states, quality, documents, ledger] = await Promise.all([
    getUnitStates(user, unitId),
    getUnitQuality(user, unitId),
    getUnitDocuments(user, unitId),
    getUnitLedger(user, unitId),
  ]);

  const ctx = await recordContext(locale, user);
  const t = await getTranslations({ locale, namespace: "recordPdf.unit" });
  const units = await getTranslations({ locale, namespace: "units" });
  const { domain, empty, when, day, grams, count, number, percent, table } = ctx;
  const stageName = (stage: LifecycleStageId | null) =>
    stage ? domain(`growthStage.${stage}`) : empty;

  // --- Details ---
  const current = profile.stageDurations.current;
  const sexName = (value: string | null) =>
    value
      ? (SEXES as readonly string[]).includes(value)
        ? units(`panels.overview.sexValues.${value as (typeof SEXES)[number]}`)
        : value
      : null;
  const sex = sexName(profile.sex);
  // A unit whose stock all shipped, or that joined another group, is not active: one status, as on
  // the unit page.
  const notActive = profile.terminal === "SHIPPED" || profile.terminal === "MERGED";
  const fields = [
    { label: t("fields.id"), value: String(profile.id) },
    { label: t("fields.type"), value: domain(`unitType.${profile.type}`) },
    ...(profile.type === "PLANT"
      ? [{ label: t("fields.plants"), value: count(profile.current?.plantCount ?? 1) }]
      : []),
    {
      label: t("fields.status"),
      value:
        notActive && profile.status === "active"
          ? domain("unitStatus.nothingLeft")
          : domain(`unitStatus.${profile.status}`),
    },
    { label: t("fields.material"), value: units(`detail.material.${profile.material}`) },
    { label: t("fields.cultivar"), value: profile.cultivar?.name ?? empty },
    { label: t("fields.sex"), value: sex ?? empty },
    {
      label: t("fields.experiment"),
      value: profile.experiment
        ? `${profile.experiment.ecode} · ${profile.experiment.name}`
        : empty,
    },
    { label: t("fields.lead"), value: profile.experiment?.leadName ?? empty },
    { label: t("fields.location"), value: profile.current?.locationName ?? empty },
    {
      label: t("fields.stage"),
      value: current
        ? t("currentStage", { day: current.days, stage: stageName(current.stage) })
        : stageName(profile.stage),
    },
    {
      label: t("fields.source"),
      value: joined(
        [
          profile.source.type ? domain(`sourceType.${profile.source.type}`) : null,
          profile.source.description,
        ],
        empty
      ),
    },
    {
      label: t("fields.provider"),
      value: joined([profile.source.provider?.name, profile.source.provider?.country], empty),
    },
    ...(profile.source.receivedAt
      ? [{ label: t("fields.received"), value: when(profile.source.receivedAt) }]
      : []),
    { label: t("fields.registered"), value: when(profile.registeredAt) },
    ...(profile.projection?.harvestOn
      ? [{ label: t("fields.expectedHarvest"), value: day(profile.projection.harvestOn) }]
      : []),
  ];
  const details: PdfBlock[] = [{ kind: "fields", fields }];
  if (profile.notes) {
    details.push({ kind: "fields", fields: [{ label: t("fields.notes"), value: profile.notes }] });
  }

  // --- Quantities ---
  const quantities = summarizeUnitQuantities(states);
  const weighed = profile.type === "PLANT" || profile.type === "FLOWER";
  const amounts = (wet: number | null, dry: number | null, seeds: number | null) =>
    joined(
      [
        wet ? ctx.t("wetValue", { value: grams(wet) }) : null,
        dry ? ctx.t("dryValue", { value: grams(dry) }) : null,
        seeds ? ctx.t("seeds", { count: seeds }) : null,
      ],
      ctx.t("nothing")
    );
  const registeredNote = (value: number | null, now: number | null, text: string | null) =>
    value !== null && value !== now && text
      ? t("figures.registeredWith", { amount: text })
      : undefined;
  const figures: Array<{ label: string; value: string; note?: string }> = [];
  if (weighed) {
    figures.push(
      {
        label: t("figures.wet"),
        value: grams(quantities.current?.wet ?? null),
        note: registeredNote(
          quantities.registered.wet,
          quantities.current?.wet ?? null,
          quantities.registered.wet === null ? null : grams(quantities.registered.wet)
        ),
      },
      {
        label: t("figures.originalDry"),
        value: grams(profile.shipping?.dry?.original ?? quantities.current?.dry ?? null),
      },
      {
        label: t("figures.dry"),
        value: grams(quantities.current?.dry ?? null),
        note: registeredNote(
          quantities.registered.dry,
          quantities.current?.dry ?? null,
          quantities.registered.dry === null ? null : grams(quantities.registered.dry)
        ),
      }
    );
  }
  if (profile.type === "SEEDLOT") {
    figures.push({
      label: t("figures.seeds"),
      value: count(quantities.current?.seeds ?? null),
      note: registeredNote(
        quantities.registered.seeds,
        quantities.current?.seeds ?? null,
        quantities.registered.seeds === null
          ? null
          : ctx.t("seeds", { count: quantities.registered.seeds })
      ),
    });
  }
  figures.push({
    label: t("figures.shipped"),
    value: amounts(quantities.shipped.wet, quantities.shipped.dry, quantities.shipped.seeds),
    note: ctx.t("shipments", { count: quantities.shipped.shipments }),
  });
  if (quantities.drying) {
    figures.push({
      label: t("figures.drying"),
      value: grams(quantities.drying.loss),
      note: `${t("figures.dryingNote", {
        wet: grams(quantities.drying.wet),
        dry: grams(quantities.drying.dry),
      })} (${ctx.t("share", { share: percent(quantities.drying.share) })})`,
    });
  }
  if (quantities.waste.entries > 0) {
    figures.push({
      label: t("figures.waste"),
      value: amounts(quantities.waste.wet, quantities.waste.dry, null),
      note: t("figures.wasteNote", { count: quantities.waste.entries }),
    });
  }
  if (quantities.destroyed) {
    figures.push({
      label: t("figures.destroyed"),
      value:
        quantities.destroyed.wet || quantities.destroyed.dry || quantities.destroyed.seeds
          ? amounts(quantities.destroyed.wet, quantities.destroyed.dry, quantities.destroyed.seeds)
          : t("figures.wholeUnit"),
      note: t("figures.atDestruction"),
    });
  }

  // --- Phases and locations ---
  const { spans, totalDays } = profile.stageDurations;
  const phases = table(
    [
      { header: t("columns.stage"), width: 3 },
      { header: t("columns.started"), width: 2 },
      { header: t("columns.ended"), width: 2 },
      { header: t("columns.days"), width: 1, align: "end" },
    ],
    spans.map((span) => [
      stageName(span.stage),
      day(span.start),
      span.ongoing ? ctx.t("ongoing") : span.end ? day(span.end) : empty,
      count(span.days),
    ]),
    { total: [ctx.t("total"), "", "", count(totalDays)] }
  );
  const locations = table(
    [
      { header: t("columns.location"), width: 3 },
      { header: t("columns.from"), width: 2 },
      { header: t("columns.to"), width: 2 },
      { header: t("columns.days"), width: 1, align: "end" },
      { header: t("columns.movedBy"), width: 2 },
    ],
    profile.locationHistory.stays.map((stay) => [
      stay.locationName,
      day(stay.from),
      stay.to ? day(stay.to) : ctx.t("ongoing"),
      count(stay.days),
      stay.movedBy ?? empty,
    ])
  );

  // --- Lineage ---
  const lineage = profile.lineage;
  const lineageFields = [
    ...(profile.parent ? [{ label: t("fields.parent"), value: profile.parent.name }] : []),
    ...(lineage.mother && lineage.mother.id !== profile.parent?.id
      ? [{ label: t("fields.mother"), value: lineage.mother.name }]
      : []),
    ...(lineage.generation > 0
      ? [{ label: t("fields.generation"), value: count(lineage.generation) }]
      : []),
    ...(profile.childCount > 0
      ? [
          {
            label: t("fields.derived"),
            value: [
              profile.children.map((child) => child.name).join(", "),
              profile.childCount > profile.children.length
                ? ctx.t("more", { count: profile.childCount - profile.children.length })
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          },
        ]
      : []),
  ];

  // --- Events: what each one changed, oldest first ---
  const eventDetails = (state: UnitStateRow, before: UnitStateRow | undefined) => {
    const changed = <K extends keyof UnitStateRow>(key: K) =>
      state[key] !== null && (!before || state[key] !== before[key]);
    const shipped = state.shipped;
    return joined(
      [
        changed("locationName") ? state.locationName : null,
        changed("growthStage") && state.growthStage
          ? domain(`growthStage.${state.growthStage}`)
          : null,
        shipped?.weight != null && shipped.moisture === "WET"
          ? t("event.shippedWet", { value: grams(shipped.weight) })
          : null,
        shipped?.weight != null && shipped.moisture === "DRY"
          ? t("event.shippedDry", { value: grams(shipped.weight) })
          : null,
        shipped?.count != null
          ? shipped.material && shipped.material !== "SEED"
            ? t("event.shippedCount", {
                count: shipped.count,
                material: domain(`materialClass.${shipped.material}`),
              })
            : t("event.shippedSeeds", { count: shipped.count })
          : null,
        state.sampled?.weight != null
          ? t(state.sampled.moisture === "DRY" ? "event.sampledDry" : "event.sampledWet", {
              value: grams(state.sampled.weight),
            })
          : null,
        state.sampled?.count != null
          ? t("event.sampledSeeds", { count: state.sampled.count })
          : null,
        state.wasted?.weight != null
          ? t(state.wasted.moisture === "DRY" ? "event.wasteDry" : "event.wasteWet", {
              value: grams(state.wasted.weight),
              type: state.wasted.type ? domain(`wasteType.${state.wasted.type}`) : empty,
            })
          : null,
        changed("humidWeight") ? t("event.wet", { value: grams(state.humidWeight) }) : null,
        changed("dryWeight") ? t("event.dry", { value: grams(state.dryWeight) }) : null,
        changed("seedCount") && state.seedCount !== null
          ? t("event.seeds", { count: state.seedCount })
          : null,
        state.kind === "REGROUPED" ? t("event.plants", { count: state.plantCount ?? 1 }) : null,
        shipped?.reference ? t("event.shipment", { reference: shipped.reference }) : null,
        state.organizationName ? t("event.organization", { name: state.organizationName }) : null,
        state.reason ? t("event.reason", { reason: state.reason }) : null,
        state.scanConfirmed ? t("event.scanned") : null,
        state.comment,
        state.recordedAt.getTime() - state.effectiveAt.getTime() > FILED_LATE_MS
          ? t("event.filed", { when: when(state.recordedAt) })
          : null,
      ],
      empty
    );
  };
  const events = table(
    [
      { header: t("columns.number"), width: 0.55, align: "end" },
      { header: t("columns.date"), width: 1.8 },
      { header: t("columns.event"), width: 1.5 },
      { header: t("columns.details"), width: 4.2 },
      { header: t("columns.by"), width: 1.5 },
    ],
    states.map((state, index) => [
      String(state.sequence),
      when(state.effectiveAt),
      domain(`stateKind.${state.kind}`),
      eventDetails(state, states[index - 1]),
      state.recordedBy,
    ])
  );

  // --- Shipments: each one, with what it took and what was left, as on the unit page ---
  const shipmentAmount = (value: number | null, measure: string) =>
    value === null ? empty : measure === "seeds" ? count(value) : grams(value);
  const shipments = table(
    [
      { header: t("columns.date"), width: 1.6 },
      { header: t("columns.shipment"), width: 1.6 },
      { header: t("columns.organization"), width: 2.2 },
      { header: t("columns.what"), width: 4.2 },
    ],
    (profile.shipping?.entries ?? []).map((entry) => [
      entry.at ? day(entry.at) : empty,
      entry.shipment?.reference ?? empty,
      entry.organization?.name ?? empty,
      entry.measure === "whole"
        ? t("shipment.whole")
        : entry.measure === "part"
          ? t("shipment.part", {
              material: entry.materialType
                ? domain(`materialClass.${entry.materialType as "SEED"}`)
                : empty,
              shipped: entry.shipped === null ? empty : number(entry.shipped),
            })
          : t(`shipment.${entry.measure}`, {
              original: shipmentAmount(entry.original, entry.measure),
              shipped: shipmentAmount(entry.shipped, entry.measure),
              left: shipmentAmount(entry.left, entry.measure),
            }),
    ])
  );

  // --- Sex changes, from the audit trail (the sex is a detail of the unit, not an event) ---
  const sexChanges = ledger
    .filter((event) => event.type === "SEX_CHANGED")
    .reverse()
    .map((event) => [
      when(new Date(event.at)),
      t("sexChange", {
        from: sexName(typeof event.facts.from === "string" ? event.facts.from : null) ?? empty,
        to: sexName(typeof event.facts.to === "string" ? event.facts.to : null) ?? empty,
      }),
      event.actor ?? empty,
    ]);
  const sexHistory = table(
    [
      { header: t("columns.date"), width: 2 },
      { header: t("columns.details"), width: 4 },
      { header: t("columns.by"), width: 2 },
    ],
    sexChanges
  );

  // --- Quality, field records, documents: oldest first, like the events ---
  const tests = table(
    [
      { header: t("columns.date"), width: 1.6 },
      { header: t("columns.test"), width: 2 },
      { header: t("columns.result"), width: 3 },
      { header: t("columns.lab"), width: 1.8 },
      { header: t("columns.by"), width: 1.6 },
    ],
    [...quality.tests]
      .reverse()
      .map((test) => [
        day(test.testedAt),
        joined([domain(`testPanel.${test.panel}`), test.analyte], empty),
        joined(
          [
            test.value !== null ? `${number(test.value)}${test.uom ? ` ${test.uom}` : ""}` : null,
            test.wetWeight !== null ? t("test.wet", { value: grams(test.wetWeight) }) : null,
            test.dryWeight !== null ? t("test.dry", { value: grams(test.dryWeight) }) : null,
            test.comment,
          ],
          t("test.noNumber")
        ),
        test.labName ?? empty,
        test.recordedBy,
      ])
  );
  const holds = table(
    [
      { header: t("columns.placed"), width: 2.4 },
      { header: t("columns.reason"), width: 3.6 },
      { header: t("columns.released"), width: 3 },
    ],
    [...quality.holds].reverse().map((hold) => [
      `${when(hold.placedAt)} · ${hold.placedBy}`,
      joined([domain(`holdOrigin.${hold.origin}`), hold.reason], empty),
      hold.releasedAt
        ? joined(
            [
              t("hold.releasedBy", {
                when: when(hold.releasedAt),
                name: hold.releasedBy ?? empty,
              }),
              hold.releaseNote,
            ],
            empty
          )
        : t("hold.stillActive"),
    ])
  );
  const incidents = table(
    [
      { header: t("columns.opened"), width: 2.4 },
      { header: t("columns.severity"), width: 1.2 },
      { header: t("columns.incident"), width: 4.4 },
      { header: t("columns.status"), width: 1.4 },
    ],
    [...quality.incidents]
      .reverse()
      .map((incident) => [
        `${when(incident.openedAt)} · ${incident.openedBy}`,
        domain(`incidentSeverity.${incident.severity}`),
        joined([`${incident.title}: ${incident.description}`, incident.resolution], empty),
        domain(`incidentStatus.${incident.status}`),
      ])
  );
  const activities = table(
    [
      { header: t("columns.date"), width: 1.8 },
      { header: t("columns.type"), width: 1.6 },
      { header: t("columns.details"), width: 4.4 },
      { header: t("columns.by"), width: 1.6 },
    ],
    [...documents.activities]
      .reverse()
      .map((activity) => [
        when(activity.date),
        domain(`activityType.${activity.type}`),
        ctx.activityText(activity),
        activity.recordedBy,
      ])
  );
  const attachments = table(
    [
      { header: t("columns.document"), width: 3 },
      { header: t("columns.category"), width: 1.4 },
      { header: t("columns.added"), width: 2.4 },
      { header: t("columns.checksum"), width: 3.2 },
    ],
    [...documents.attachments]
      .reverse()
      .map((attachment) => [
        `${attachment.label} (${attachment.fileName})`,
        domain(`attachmentCategory.${attachment.category}`),
        `${when(attachment.uploadedAt)} · ${attachment.uploadedBy}`,
        attachment.sha256 ?? empty,
      ])
  );

  const none: PdfBlock[] = [{ kind: "text", text: ctx.t("none"), muted: true }];
  const sections: PdfSection[] = [
    { title: t("sections.details"), blocks: details },
    {
      title: t("sections.quantities"),
      blocks: [
        { kind: "figures", figures },
        { kind: "text", text: t("quantitiesNote"), muted: true },
      ],
    },
    {
      title: t("sections.phases"),
      blocks: spans.length
        ? [
            ...phases,
            { kind: "text", text: t("trackedSince", { date: day(spans[0]!.start) }), muted: true },
          ]
        : phases,
    },
    { title: t("sections.locations"), blocks: locations },
    ...(profile.shipping ? [{ title: t("sections.shipments"), blocks: shipments }] : []),
    ...(sexChanges.length ? [{ title: t("sections.sex"), blocks: sexHistory }] : []),
    {
      title: t("sections.lineage"),
      blocks: lineageFields.length ? [{ kind: "fields", fields: lineageFields }] : none,
    },
    ...(LAB_RESULTS_SHOWN ? [{ title: t("sections.tests"), blocks: tests }] : []),
    { title: t("sections.holds"), blocks: holds },
    { title: t("sections.incidents"), blocks: incidents },
    { title: t("sections.activities"), blocks: activities },
    ...(profile.destruction
      ? [
          {
            title: t("sections.destruction"),
            blocks: [
              {
                kind: "fields" as const,
                fields: [
                  { label: t("fields.destroyedOn"), value: when(profile.destruction.at) },
                  { label: t("fields.recordedBy"), value: profile.destruction.recordedBy ?? empty },
                  { label: t("fields.reason"), value: profile.destruction.reason ?? empty },
                ],
              },
            ],
          },
        ]
      : []),
    { title: t("sections.events"), blocks: events },
    { title: t("sections.documents"), blocks: attachments },
  ];

  return {
    record: ctx.record({
      title: t("title"),
      subject: profile.name,
      subtitle: joined(
        [
          domain(`unitType.${profile.type}`),
          profile.cultivar?.name,
          profile.experiment ? `${profile.experiment.ecode} · ${profile.experiment.name}` : null,
        ],
        ""
      ),
      qrUrl: getUnitProfileUrl(env().APP_URL, profile.id),
      sections,
    }),
    filename: ctx.filename("unit-record", profile.name),
  };
}
