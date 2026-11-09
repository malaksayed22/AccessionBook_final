"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { MaterialTotalsText } from "@/components/MaterialFigures";
import { UnitPicker } from "@/components/UnitPicker";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import { IconButton } from "@/components/ui/IconButton";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { MATERIAL_CLASSES, isWeightBased, sumMaterials } from "@/lib/materials";
import {
  emptyLine,
  lineProblems,
  linePayload,
  lineQuantity,
  partMaterials,
  type LineDraft,
  type LineProblem,
  type ShipMode,
} from "@/lib/shipment-draft";

type Direction = "INBOUND" | "OUTBOUND";

/** A unit the picker found, with what a line for it starts from (see `searchShippableUnits`). */
type ShippableUnit = {
  id: number;
  name: string;
  type: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE";
  cultivarId: number | null;
  cultivarName: string | null;
  locationName: string | null;
  suggestion: {
    materialType: string;
    unitCount: number | null;
    weightGrams: number | null;
    moisture: "WET" | "DRY" | null;
  };
  /** What is left to ship (null = never recorded). */
  available: { wetGrams: number | null; dryGrams: number | null; seeds: number | null };
};

type Props = {
  organizations: Array<{ id: number; name: string; licenceNumber: string | null }>;
  cultivars: Array<{ id: number; name: string }>;
  /** Opened from a unit's "Ship" action: an outbound shipment that starts with this unit. */
  initialUnit?: ShippableUnit;
};

type HeaderErrors = { organization?: string; lines?: string };

/** What a unit can give as a part: its own material when it divides, and parts of other kinds. */
function unitPartMaterials(unit: ShippableUnit): readonly string[] {
  const weighed = unit.available.wetGrams !== null || unit.available.dryGrams !== null;
  return partMaterials(unit.type, weighed);
}

/**
 * A shipment line for a unit from inventory: all that is left of it, or a part of it whose material
 * is still to choose.
 */
function lineForUnit(unit: ShippableUnit, key: number, mode: ShipMode): LineDraft {
  return {
    ...emptyLine(key),
    ...(mode === "all" ? allOf(unit) : partOf(unit)),
    description: unit.name,
    unitName: unit.name,
  };
}

/** The line fields for a part of the unit: the material and amount are chosen on the line. */
function partOf(unit: ShippableUnit): Partial<LineDraft> {
  return {
    shipMode: "part",
    materialType: "",
    unitCount: "",
    weightGrams: "",
    moisture: "",
    cultivarId: unit.cultivarId === null ? "" : String(unit.cultivarId),
    unitId: String(unit.id),
  };
}

/** The line fields for shipping all that is left of the unit, as its own material. */
function allOf(unit: ShippableUnit): Partial<LineDraft> {
  const { suggestion } = unit;
  return {
    shipMode: "all",
    materialType: suggestion.materialType,
    unitCount: suggestion.unitCount === null ? "" : String(suggestion.unitCount),
    weightGrams: suggestion.weightGrams === null ? "" : String(suggestion.weightGrams),
    moisture: suggestion.moisture ?? "",
    cultivarId: unit.cultivarId === null ? "" : String(unit.cultivarId),
    unitId: String(unit.id),
  };
}

const STATUSES = ["DRAFT", "IN_TRANSIT", "DELIVERED"] as const;

export function ShipmentForm({ organizations, cultivars, initialUnit }: Props) {
  const t = useTranslations("materials.form");
  const domain = useTranslations("domain");
  const router = useRouter();
  const { toast } = useToast();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [direction, setDirection] = useState<Direction>(initialUnit ? "OUTBOUND" : "INBOUND");
  const [organizationId, setOrganizationId] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("DRAFT");
  const [shippedDate, setShippedDate] = useState("");
  const [deliveredDate, setDeliveredDate] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [comment, setComment] = useState("");
  // Shipping all of each unit, or parts of it: chosen once, above the lines.
  const [mode, setMode] = useState<ShipMode>("all");
  const [lines, setLines] = useState<LineDraft[]>([
    initialUnit ? lineForUnit(initialUnit, 1, "all") : emptyLine(1),
  ]);
  // Each unit line's unit, by line key: what is left of it and what it can ship as a part.
  const [units, setUnits] = useState<Record<number, ShippableUnit>>(
    initialUnit ? { 1: initialUnit } : {}
  );
  const [submitted, setSubmitted] = useState(false);
  const [headerErrors, setHeaderErrors] = useState<HeaderErrors>({});
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);

  const outbound = direction === "OUTBOUND";
  const problems = useMemo(() => lineProblems(lines, outbound), [lines, outbound]);
  const totals = useMemo(() => sumMaterials(lines.map(lineQuantity)), [lines]);
  const organization = organizations.find((org) => String(org.id) === organizationId);
  const leaves = outbound && status !== "DRAFT";

  const patchLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  const nextKey = () => Math.max(0, ...lines.map((line) => line.key)) + 1;

  function changeDirection(next: Direction) {
    setDirection(next);
    // Received material is registered as units elsewhere, so a received line never names a unit,
    // and it is filled in freely (not all or part of anything).
    if (next === "INBOUND") {
      setLines((previous) =>
        previous.map((line) =>
          line.unitId ? { ...line, unitId: "", unitName: "", shipMode: "" } : line
        )
      );
      setUnits({});
    } else {
      // Every shipped line is a unit from inventory, so lines that are not one are dropped; each
      // unit is picked again with "Add a unit from inventory".
      setLines((previous) => previous.filter((line) => line.unitId));
      setMode("all");
    }
  }

  function addUnitLine(unit: ShippableUnit) {
    const line = lineForUnit(unit, nextKey(), mode);
    setUnits((previous) => ({ ...previous, [line.key]: unit }));
    // A starting blank line is replaced instead of left behind.
    setLines((previous) =>
      previous.length === 1 && !previous[0]!.description.trim() ? [line] : [...previous, line]
    );
  }

  /** "250 g wet left" for a unit line, on the basis the line ships; undefined for other lines. */
  function leftHint(line: LineDraft): string | undefined {
    const left = units[line.key]?.available;
    if (!left) return undefined;
    if (isWeightBased(line.materialType)) {
      if (line.moisture !== "WET" && line.moisture !== "DRY") return undefined;
      const grams = line.moisture === "DRY" ? left.dryGrams : left.wetGrams;
      return grams === null
        ? t(line.moisture === "DRY" ? "noDryWeightLeft" : "noWetWeightLeft")
        : t(line.moisture === "DRY" ? "gramsLeftDry" : "gramsLeftWet", { grams });
    }
    return left.seeds === null ? undefined : t("seedsLeft", { count: left.seeds });
  }

  /** What leaves when all of a unit ships: "Flower · 85 g dry", or the whole plant. */
  function allText(line: LineDraft): string {
    const material = domain(`materialClass.${line.materialType as "SEED"}`);
    if (isWeightBased(line.materialType)) {
      return line.weightGrams && (line.moisture === "WET" || line.moisture === "DRY")
        ? t(line.moisture === "DRY" ? "allDry" : "allWet", {
            material,
            grams: Number(line.weightGrams),
          })
        : t("allNoWeight", { material });
    }
    return t("allCount", { material, count: Number(line.unitCount || 1) });
  }

  /** What the picker shows under a unit: its cultivar and what is left of it. */
  function unitMeta(unit: ShippableUnit): string {
    const { wetGrams, dryGrams, seeds } = unit.available;
    const left =
      unit.type === "FLOWER"
        ? [
            wetGrams !== null ? t("gramsLeftWet", { grams: wetGrams }) : null,
            dryGrams !== null ? t("gramsLeftDry", { grams: dryGrams }) : null,
          ]
            .filter(Boolean)
            .join(", ") || t("noWeightRecorded")
        : seeds !== null
          ? t("seedsLeft", { count: seeds })
          : null;
    return [unit.cultivarName ?? unit.locationName, left].filter(Boolean).join(" · ");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    setSubmitted(true);
    const errors: HeaderErrors = {};
    if (!organizationId) errors.organization = t("organizationRequired");
    if (lines.length === 0) errors.lines = t(outbound ? "unitsRequired" : "linesRequired");
    setHeaderErrors(errors);
    if (errors.organization || errors.lines || Object.keys(problems).length > 0) return;

    setSaving(true);
    const result = await sendJson<{ shipment: { id: number; reference: string } }>(
      "/api/shipments",
      {
        direction,
        organizationId: Number(organizationId),
        status,
        shippedDate: shippedDate || undefined,
        deliveredDate: deliveredDate || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        licenceNumber: licenceNumber.trim() || undefined,
        comment: comment.trim() || undefined,
        items: lines.map(linePayload),
      }
    );
    setSaving(false);
    if (!result.ok) return setFailure(result.network ? networkMessage : describe(result.error));

    toast({
      tone: "success",
      title: t("saved"),
      description: t("savedReference", { reference: result.data.shipment.reference }),
    });
    router.push(`/inventory/materials/${result.data.shipment.id}`);
  }

  /**
   * All of each unit, or parts of it. Back to all, each unit keeps one line with what is left of it;
   * a part starts empty, with its material still to choose.
   */
  function changeMode(next: ShipMode) {
    setMode(next);
    const kept = new Set<string>();
    setLines((previous) =>
      previous.flatMap((line) => {
        const unit = units[line.key];
        if (!unit) return [line];
        if (next === "all") {
          if (kept.has(line.unitId)) return [];
          kept.add(line.unitId);
          return [{ ...line, ...allOf(unit) }];
        }
        return [{ ...line, ...partOf(unit) }];
      })
    );
  }

  /** Another part of a unit: a new line, with its own material and amount (the same material again is fine). */
  function addPart(unit: ShippableUnit) {
    const key = nextKey();
    setUnits((previous) => ({ ...previous, [key]: unit }));
    setLines((previous) => [...previous, lineForUnit(unit, key, "part")]);
  }

  // The units on the shipment, once each, in the order they were added.
  const shippedUnits = [
    ...new Map(
      lines.flatMap((line) => {
        const unit = units[line.key];
        return unit ? [[unit.id, unit] as const] : [];
      })
    ).values(),
  ];
  const canPart = shippedUnits.some((unit) => unitPartMaterials(unit).length > 0);
  const problemText = (problem: LineProblem | undefined, ...only: LineProblem[]) =>
    submitted && problem && only.includes(problem) ? t(`problems.${problem}`) : undefined;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {failure ? <Banner tone="danger">{failure}</Banner> : null}

      <Panel>
        <PanelHeader title={t("movementTitle")} />
        <PanelBody className="flex flex-col gap-6">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">{t("direction")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["INBOUND", "OUTBOUND"] as const).map((value) => (
                <label
                  key={value}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border-input bg-surface px-4 py-3 text-sm font-medium text-fg",
                    "has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
                  )}
                >
                  <input
                    type="radio"
                    name="direction"
                    value={value}
                    checked={direction === value}
                    onChange={() => changeDirection(value)}
                    className="size-4 shrink-0 p-0 accent-accent"
                  />
                  {value === "INBOUND" ? t("receiving") : t("shipping")}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={outbound ? t("organizationTo") : t("organizationFrom")}
              error={headerErrors.organization}
              required
            >
              {(control) => (
                <Select
                  {...control}
                  value={organizationId}
                  onChange={(event) => {
                    setOrganizationId(event.target.value);
                    setHeaderErrors({});
                  }}
                >
                  <option value="">{t("organizationPlaceholder")}</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={t("status")} hint={leaves ? t("statusLeavesHint") : undefined}>
              {(control) => (
                <Select
                  {...control}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as (typeof STATUSES)[number])}
                >
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {domain(`shipmentStatus.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={outbound ? t("dateShipped") : t("dateDispatched")} hint={t("dateHint")}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={shippedDate}
                  onChange={(event) => setShippedDate(event.target.value)}
                />
              )}
            </Field>

            <Field label={outbound ? t("dateDelivered") : t("dateReceived")} hint={t("dateHint")}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={deliveredDate}
                  onChange={(event) => setDeliveredDate(event.target.value)}
                />
              )}
            </Field>

            <Field label={t("tracking")}>
              {(control) => (
                <Input
                  {...control}
                  value={trackingNumber}
                  maxLength={200}
                  onChange={(event) => setTrackingNumber(event.target.value)}
                />
              )}
            </Field>

            <Field
              label={t("licence")}
              hint={
                organization?.licenceNumber
                  ? t("licenceDefault", { licence: organization.licenceNumber })
                  : t("licenceHint")
              }
            >
              {(control) => (
                <Input
                  {...control}
                  value={licenceNumber}
                  maxLength={100}
                  onChange={(event) => setLicenceNumber(event.target.value)}
                />
              )}
            </Field>
          </div>
        </PanelBody>
      </Panel>

      {outbound ? (
        <Panel>
          <PanelBody>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-fg">{t("shipMode")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["all", "part"] as const).map((value) => (
                  <label
                    key={value}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border-input bg-surface px-4 py-3 text-sm font-medium text-fg",
                      "has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text",
                      "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                      "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                    )}
                  >
                    <input
                      type="radio"
                      name="ship-mode"
                      value={value}
                      checked={mode === value}
                      disabled={value === "part" && shippedUnits.length > 0 && !canPart}
                      onChange={() => changeMode(value)}
                      className="size-4 shrink-0 p-0 accent-accent"
                    />
                    <span>
                      {t(value === "all" ? "shipAll" : "shipPart")}
                      <span className="block text-xs font-normal text-fg-secondary">
                        {value === "part" && shippedUnits.length > 0 && !canPart
                          ? t("shipPartWhole")
                          : t(value === "all" ? "shipAllHint" : "shipPartHint")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title={t("linesTitle")} description={t("linesHint")} />
        <PanelBody className="flex flex-col gap-6">
          {outbound ? (
            <UnitPicker<ShippableUnit>
              endpoint="/api/shipments/unit-options"
              label={t("pickUnit")}
              hint={t("pickUnitHint")}
              renderMeta={unitMeta}
              onPick={addUnitLine}
            />
          ) : null}

          <ol className="flex flex-col gap-4">
            {lines.map((line, index) => {
              const weighed = isWeightBased(line.materialType);
              const problem = problems[line.key];
              const unit = units[line.key];
              const part = line.shipMode === "part";
              // Shipping all of a unit: what is left is filled in and cannot be changed.
              const wholeUnit = line.shipMode === "all";
              return (
                <li
                  key={line.key}
                  className="flex flex-col gap-4 rounded-lg border border-border bg-transparent p-4"
                  aria-label={t("lineLabel", { number: index + 1 })}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">
                      {t("lineLabel", { number: index + 1 })}
                      {line.unitName ? (
                        <span className="ms-2 font-normal text-fg-secondary">
                          {t("lineUnit", { name: line.unitName })}
                        </span>
                      ) : null}
                    </h3>
                    <IconButton
                      label={t("removeLine", { number: index + 1 })}
                      variant="ghost"
                      size="sm"
                      disabled={lines.length === 1 && !outbound}
                      onClick={() =>
                        setLines((previous) => previous.filter((l) => l.key !== line.key))
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label={t("lineDescription")}
                      error={problemText(problem, "description")}
                      className="lg:col-span-2"
                      required
                    >
                      {(control) => (
                        <Input
                          {...control}
                          value={line.description}
                          maxLength={300}
                          onChange={(event) =>
                            patchLine(line.key, { description: event.target.value })
                          }
                        />
                      )}
                    </Field>

                    {wholeUnit ? (
                      <div className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
                        <p className="text-sm font-medium text-fg">{t("allLeaves")}</p>
                        <p className="text-sm leading-5 text-fg">{allText(line)}</p>
                      </div>
                    ) : (
                      <>
                        <Field
                          label={t("lineMaterial")}
                          error={problemText(problem, "needsUnit", "materialMissing")}
                          required={part}
                        >
                          {(control) => (
                            <Select
                              {...control}
                              value={line.materialType}
                              // All of a unit ships as what the unit is; a part names what it is.
                              disabled={wholeUnit}
                              onChange={(event) =>
                                patchLine(line.key, {
                                  materialType: event.target.value,
                                  unitCount: "",
                                  weightGrams: "",
                                  moisture: "",
                                })
                              }
                            >
                              {part ? (
                                <option value="">{t("lineMaterialPlaceholder")}</option>
                              ) : null}
                              {MATERIAL_CLASSES.filter((material) =>
                                part && unit
                                  ? unitPartMaterials(unit).includes(material.id)
                                  : !outbound || material.id === line.materialType
                              ).map((material) => (
                                <option key={material.id} value={material.id}>
                                  {domain(`materialClass.${material.id}`)}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>

                        {weighed ? (
                          <>
                            <Field
                              label={t("lineWeight")}
                              hint={leftHint(line)}
                              error={problemText(problem, "weightMissing", "negative")}
                              required
                            >
                              {(control) => (
                                <Input
                                  {...control}
                                  type="number"
                                  inputMode="decimal"
                                  step="0.001"
                                  min="0"
                                  value={line.weightGrams}
                                  readOnly={wholeUnit}
                                  onChange={(event) =>
                                    patchLine(line.key, { weightGrams: event.target.value })
                                  }
                                />
                              )}
                            </Field>
                            <Field
                              label={t("lineBasis")}
                              error={problemText(problem, "basisMissing")}
                              required
                            >
                              {(control) => (
                                <Select
                                  {...control}
                                  value={line.moisture}
                                  disabled={wholeUnit}
                                  onChange={(event) =>
                                    patchLine(line.key, { moisture: event.target.value })
                                  }
                                >
                                  <option value="">{t("lineBasisPlaceholder")}</option>
                                  {/* A unit with a dry weight is dried material: it ships by dry weight. */}
                                  <option
                                    value="WET"
                                    disabled={(unit?.available.dryGrams ?? null) !== null}
                                  >
                                    {domain("moisture.WET")}
                                  </option>
                                  <option value="DRY">{domain("moisture.DRY")}</option>
                                </Select>
                              )}
                            </Field>
                          </>
                        ) : (
                          <Field
                            label={t("lineCount")}
                            hint={leftHint(line)}
                            error={problemText(
                              problem,
                              "countMissing",
                              "countNotWhole",
                              "negative"
                            )}
                            required
                          >
                            {(control) => (
                              <Input
                                {...control}
                                type="number"
                                inputMode="numeric"
                                step="1"
                                min="0"
                                value={line.unitCount}
                                readOnly={wholeUnit}
                                onChange={(event) =>
                                  patchLine(line.key, { unitCount: event.target.value })
                                }
                              />
                            )}
                          </Field>
                        )}
                      </>
                    )}

                    {/* A shipped line's cultivar is the unit's: it is not chosen here. */}
                    {outbound ? null : (
                      <Field label={t("lineCultivar")} className="lg:col-span-2">
                        {(control) => (
                          <Select
                            {...control}
                            value={line.cultivarId}
                            onChange={(event) =>
                              patchLine(line.key, { cultivarId: event.target.value })
                            }
                          >
                            <option value="">{domain("empty")}</option>
                            {cultivars.map((cultivar) => (
                              <option key={cultivar.id} value={cultivar.id}>
                                {cultivar.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    )}

                    <Field label={t("lineComment")} className="sm:col-span-2 lg:col-span-2">
                      {(control) => (
                        <Input
                          {...control}
                          value={line.comment}
                          maxLength={1000}
                          onChange={(event) => patchLine(line.key, { comment: event.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            {outbound ? (
              // All of a unit leaves on its one line: there is nothing else to add. A part can be
              // followed by parts of other kinds of the same unit.
              mode === "part" ? (
                <div className="flex flex-wrap gap-2">
                  {shippedUnits.map((unit) => (
                    <Button key={unit.id} variant="secondary" onClick={() => addPart(unit)}>
                      {shippedUnits.length > 1
                        ? t("addOtherPartOf", { name: unit.name })
                        : t("addOtherPart")}
                    </Button>
                  ))}
                </div>
              ) : (
                <span />
              )
            ) : (
              <Button
                variant="secondary"
                onClick={() => setLines((previous) => [...previous, emptyLine(nextKey())])}
              >
                {t("addLine")}
              </Button>
            )}
            <p className="text-sm">
              <span className="text-fg-secondary">{t("manifestTotal")} </span>
              <span className="font-medium">
                <MaterialTotalsText totals={totals} />
              </span>
            </p>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <Field label={t("notes")} hint={t("notesHint")}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={comment}
                maxLength={2000}
                onChange={(event) => setComment(event.target.value)}
              />
            )}
          </Field>
        </PanelBody>
      </Panel>

      {submitted && headerErrors.lines ? <Banner tone="danger">{headerErrors.lines}</Banner> : null}
      {submitted && (headerErrors.organization || Object.keys(problems).length > 0) ? (
        <Banner tone="danger">{t("fixErrors")}</Banner>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button href="/inventory/materials" variant="secondary">
          {t("cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
