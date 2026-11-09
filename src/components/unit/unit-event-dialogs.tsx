"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import { canConfirm } from "@/components/ui/confirm-logic";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useApiError, useNetworkError, type ApiErrorBody } from "@/lib/api-error";
import { sendJson, type ApiResult } from "@/lib/client-api";
import { toDateInputValue } from "@/lib/format";
import { laterStages } from "@/lib/stage-order";
import {
  DERIVE_TYPES,
  SEX_VALUES,
  STAGE_OPTION_IDS,
  type DeriveType,
} from "@/lib/unit-action-constants";
import { ActionDialog } from "./ActionDialog";
import { AddLocation } from "./AddLocation";
import type { DialogProps, Option } from "./action-types";

/*
 * Forms for the events that change a unit: move, stage, measure, derive, edit details, link a parent
 * and destroy. Each one only collects input and calls the existing API route; every rule (who may,
 * whether a hold blocks it, valid dates) is enforced by the service on the server.
 */

const NOTE_MAX = 2000;
const DESTROY_REASON_MIN = 10;

export function MoveDialog({
  unit,
  locations,
  canAddLocation = false,
  onClose,
}: DialogProps & { locations: Option[]; canAddLocation?: boolean }) {
  const t = useTranslations("units.actions.move");
  const [added, setAdded] = useState<Option[]>([]);
  const [locationId, setLocationId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [comment, setComment] = useState("");
  const options = [...locations, ...added].filter((l) => l.id !== unit.locationId);

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={locationId !== "" && barcode.trim() !== ""}
      send={() =>
        sendJson<{ location: string }>(`/api/units/${unit.id}/transfer`, {
          toLocationId: Number(locationId),
          barcode: barcode.trim(),
          comment: comment.trim(),
        })
      }
      successTitle={(data) => t("success", { location: data.location })}
      onClose={onClose}
    >
      <Field label={t("destination")} required>
        {(control) => (
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} {...control}>
            <option value="">{t("choose")}</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {canAddLocation ? (
        <AddLocation
          onAdded={(location) => {
            setAdded((current) => [...current, location]);
            setLocationId(String(location.id));
          }}
        />
      ) : null}
      <Field label={t("barcode")} hint={t("barcodeHint", { name: unit.name })} required>
        {(control) => (
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            {...control}
          />
        )}
      </Field>
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={NOTE_MAX}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

export function StageDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.stage");
  const domain = useTranslations("domain");
  const [toStage, setToStage] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [comment, setComment] = useState("");
  // Stages only move forward, so only the later ones are offered.
  const options = laterStages(unit.growthStage);

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={toStage !== ""}
      send={() =>
        sendJson<{ toStage: (typeof STAGE_OPTION_IDS)[number] }>(
          `/api/units/${unit.id}/stage-transition`,
          { toStage, effectiveAt: effectiveAt || undefined, comment: comment.trim() }
        )
      }
      successTitle={(data) => t("success", { stage: domain(`growthStage.${data.toStage}`) })}
      onClose={onClose}
    >
      <Field label={t("newStage")} hint={t("earlierHint")} required>
        {(control) => (
          <Select value={toStage} onChange={(e) => setToStage(e.target.value)} {...control}>
            <option value="">{t("choose")}</option>
            {options.map((id) => (
              <option key={id} value={id}>
                {domain(`growthStage.${id}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("effectiveDate")} hint={t("effectiveDateHint")}>
        {(control) => (
          <Input
            type="date"
            value={effectiveAt}
            max={toDateInputValue()}
            onChange={(e) => setEffectiveAt(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={NOTE_MAX}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

/**
 * Records a weight or a seed count. A weight already on record is locked: a mistake is reported as
 * an incident.
 */
export function MeasureDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.measure");
  const format = useFormatter();
  const weighs = unit.type === "PLANT" || unit.type === "FLOWER";
  const [humid, setHumid] = useState("");
  const [dry, setDry] = useState("");
  const [seeds, setSeeds] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [comment, setComment] = useState("");

  const current = (value: number | null, formatted: string) =>
    value === null ? t("noCurrent") : t("current", { value: formatted });
  const entered = weighs ? humid !== "" || dry !== "" : seeds !== "";
  const wetLocked = unit.humidWeight !== null;
  const dryLocked = unit.dryWeight !== null;

  return (
    <ActionDialog
      title={weighs ? t("titleWeight") : t("title")}
      description={
        weighs ? t("descriptionWeight", { name: unit.name }) : t("description", { name: unit.name })
      }
      submitLabel={weighs ? t("submitWeight") : t("submit")}
      canSubmit={entered}
      send={() =>
        sendJson(`/api/units/${unit.id}/measure`, {
          humidWeight: weighs && humid !== "" ? Number(humid) : undefined,
          dryWeight: weighs && dry !== "" ? Number(dry) : undefined,
          seedCount: !weighs && seeds !== "" ? Number(seeds) : undefined,
          effectiveAt: effectiveAt || undefined,
          comment: comment.trim(),
        })
      }
      successTitle={() => (weighs ? t("successWeight") : t("success"))}
      onClose={onClose}
    >
      {weighs ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("humidWeight")}
            hint={
              wetLocked
                ? t("locked", { value: format.number(unit.humidWeight ?? 0, "grams") })
                : current(unit.humidWeight, format.number(unit.humidWeight ?? 0, "grams"))
            }
          >
            {(control) => (
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                disabled={wetLocked}
                value={humid}
                onChange={(e) => setHumid(e.target.value)}
                {...control}
              />
            )}
          </Field>
          <Field
            label={t("dryWeight")}
            hint={
              dryLocked
                ? t("locked", { value: format.number(unit.dryWeight ?? 0, "grams") })
                : current(unit.dryWeight, format.number(unit.dryWeight ?? 0, "grams"))
            }
          >
            {(control) => (
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                disabled={dryLocked}
                value={dry}
                onChange={(e) => setDry(e.target.value)}
                {...control}
              />
            )}
          </Field>
        </div>
      ) : (
        <Field
          label={t("seedCount")}
          hint={current(unit.seedCount, format.number(unit.seedCount ?? 0, "count"))}
        >
          {(control) => (
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={seeds}
              onChange={(e) => setSeeds(e.target.value)}
              {...control}
            />
          )}
        </Field>
      )}
      <Field label={t("effectiveDate")} hint={t("effectiveDateHint")}>
        {(control) => (
          <Input
            type="date"
            value={effectiveAt}
            max={toDateInputValue()}
            onChange={(e) => setEffectiveAt(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={NOTE_MAX}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

export function DeriveDialog({ unit, locations, onClose }: DialogProps & { locations: Option[] }) {
  const t = useTranslations("units.actions.derive");
  const kinds: readonly DeriveType[] = unit.type === "CULTURE" ? ["subculture"] : DERIVE_TYPES;
  const [deriveType, setDeriveType] = useState<DeriveType>(kinds[0] ?? "clone");
  const [quantity, setQuantity] = useState("1");
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [comment, setComment] = useState("");
  const [experimentChoice, setExperimentChoice] = useState<"same" | "new">("same");
  const [experimentName, setExperimentName] = useState("");
  const count = Number(quantity);
  const validCount = Number.isInteger(count) && count >= 1 && count <= 50;
  const newExperiment = experimentChoice === "new";

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={validCount && (!newExperiment || experimentName.trim() !== "")}
      send={() =>
        sendJson<{
          units: Array<{ unitId: number; unitName: string }>;
          experiment: { id: number; ecode: string; name: string } | null;
        }>(`/api/units/${unit.id}/derive`, {
          deriveType,
          quantity: count,
          name: name.trim() || undefined,
          locationId: locationId ? Number(locationId) : undefined,
          comment: comment.trim() || undefined,
          newExperiment: newExperiment ? { name: experimentName.trim() } : undefined,
        })
      }
      successTitle={(data) =>
        data.experiment
          ? t("successNewExperiment", {
              count: data.units.length,
              names: data.units.map((u) => u.unitName).join(", "),
              experiment: data.experiment.ecode,
            })
          : t("success", {
              count: data.units.length,
              names: data.units.map((u) => u.unitName).join(", "),
            })
      }
      onClose={onClose}
    >
      <Field label={t("kind")} required>
        {(control) => (
          <Select
            value={deriveType}
            onChange={(e) => setDeriveType(e.target.value as DeriveType)}
            {...control}
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("quantity")} hint={t("quantityHint")} required>
          {(control) => (
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("location")} hint={t("locationHint")}>
          {(control) => (
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} {...control}>
              <option value="">{t("sameLocation")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t("experiment")} required>
        {(control) => (
          <Select
            value={experimentChoice}
            onChange={(e) => setExperimentChoice(e.target.value as "same" | "new")}
            {...control}
          >
            <option value="same">
              {unit.experiment
                ? t("sameExperiment", { code: unit.experiment.ecode, name: unit.experiment.name })
                : t("sameExperimentNone")}
            </option>
            <option value="new">{t("newExperiment")}</option>
          </Select>
        )}
      </Field>
      {newExperiment ? (
        <Field
          label={t("newExperimentName")}
          hint={t("newExperimentHint", { code: unit.experiment?.ecode ?? "—" })}
          required
        >
          {(control) => (
            <Input
              value={experimentName}
              maxLength={200}
              onChange={(e) => setExperimentName(e.target.value)}
              autoComplete="off"
              {...control}
            />
          )}
        </Field>
      ) : null}
      <Field label={t("name")} hint={t("nameHint", { name: unit.name })}>
        {(control) => (
          <Input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            {...control}
          />
        )}
      </Field>
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={NOTE_MAX}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Banner tone="info">{t("next")}</Banner>
    </ActionDialog>
  );
}

export function EditDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.edit");
  const destroyed = unit.terminal === "DESTROYED";
  const [notes, setNotes] = useState(unit.notes ?? "");

  return (
    <ActionDialog
      title={t("title")}
      description={destroyed ? t("notesDescription") : t("description", { name: unit.name })}
      submitLabel={t("submit")}
      send={() =>
        sendJson<{ unchanged?: boolean }>(
          `/api/units/${unit.id}`,
          { comment: notes.trim() },
          "PATCH"
        )
      }
      successTitle={(data) => (data.unchanged ? t("unchanged") : t("success"))}
      onClose={onClose}
    >
      <Field label={t("notes")} hint={t("notesHint", { max: NOTE_MAX })}>
        {(control) => (
          <Textarea
            rows={5}
            value={notes}
            maxLength={NOTE_MAX}
            onChange={(e) => setNotes(e.target.value)}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

/**
 * The key-facts card's Edit: the sex of the unit and its growth stage. A stage change is recorded as
 * a stage event (so the history and the timeline keep it), exactly like "Change growth stage"; it is
 * left out while the unit is on hold or when stages do not apply to the unit.
 */
export function EditDetailsDialog({
  unit,
  canChangeStage,
  onClose,
}: DialogProps & { canChangeStage: boolean }) {
  const t = useTranslations("units.actions.editDetails");
  const stages = useTranslations("units.actions.stage");
  const sexText = useTranslations("units.actions.edit.sexValues");
  const domain = useTranslations("domain");
  const hasStages = unit.type === "PLANT" || unit.type === "FLOWER";
  const [sex, setSex] = useState(unit.sex ?? "");
  const [toStage, setToStage] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const known = (SEX_VALUES as readonly string[]).includes(sex) || sex === "";
  const sexChanged = sex !== "" && sex !== (unit.sex ?? "");
  const stageChanged = toStage !== "";
  // Stages only move forward: once the last one is reached, there is nothing to choose.
  const options = laterStages(unit.growthStage);

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={sexChanged || stageChanged}
      send={async (): Promise<ApiResult<{ unchanged?: boolean }>> => {
        if (sexChanged) {
          const result = await sendJson<{ unchanged?: boolean }>(
            `/api/units/${unit.id}`,
            { sex },
            "PATCH"
          );
          if (!result.ok) return result;
        }
        if (stageChanged) {
          const result = await sendJson(`/api/units/${unit.id}/stage-transition`, {
            toStage,
            effectiveAt: effectiveAt || undefined,
          });
          if (!result.ok) return result;
        }
        return { ok: true, data: {} };
      }}
      successTitle={() => t("success")}
      onClose={onClose}
    >
      <Field label={t("sex")}>
        {(control) => (
          <Select value={sex} onChange={(e) => setSex(e.target.value)} {...control}>
            <option value="">{unit.sex ? sexText(unit.sex as "MALE") : t("unspecified")}</option>
            {known ? null : <option value={sex}>{sex}</option>}
            {SEX_VALUES.filter((value) => value !== unit.sex).map((value) => (
              <option key={value} value={value}>
                {sexText(value)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {hasStages ? (
        <>
          <Field label={t("stage")} hint={canChangeStage ? stages("earlierHint") : t("stageHeld")}>
            {(control) => (
              <Select
                value={toStage}
                disabled={!canChangeStage || options.length === 0}
                onChange={(e) => setToStage(e.target.value)}
                {...control}
              >
                <option value="">
                  {unit.growthStage
                    ? `${t("keepStage")} (${domain(`growthStage.${unit.growthStage}`)})`
                    : t("keepStage")}
                </option>
                {options.map((id) => (
                  <option key={id} value={id}>
                    {domain(`growthStage.${id}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {stageChanged ? (
            <Field label={t("effectiveDate")} hint={t("effectiveDateHint")}>
              {(control) => (
                <Input
                  type="date"
                  value={effectiveAt}
                  max={toDateInputValue()}
                  onChange={(e) => setEffectiveAt(e.target.value)}
                  {...control}
                />
              )}
            </Field>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-fg-secondary">{t("stageNotApplicable")}</p>
      )}
    </ActionDialog>
  );
}

type Candidate = { id: number; name: string; type: string };

export function LinkParentDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.linkParent");
  const domain = useTranslations("domain");
  const apiError = useApiError();
  const networkError = useNetworkError();
  const [term, setTerm] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailure, setSearchFailure] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [comment, setComment] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const label = (c: Candidate) => `${c.name} (${domain(`unitType.${c.type as "PLANT"}`)})`;
  // The chosen unit stays in the list so the field keeps showing it after the search is cleared.
  const options = [
    ...(chosen ? [chosen] : []),
    ...candidates.filter((c) => c.id !== chosen?.id),
  ].map((c) => ({ value: String(c.id), label: label(c) }));

  const search = (value: string) => {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);
    request.current += 1;
    const current = request.current;
    if (value.trim().length < 2) {
      setCandidates([]);
      setSearching(false);
      setSearchFailure(null);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      let outcome: Candidate[] | string;
      try {
        const response = await fetch(
          `/api/units/${unit.id}/parent-candidates?q=${encodeURIComponent(value.trim())}`
        );
        const body = (await response.json().catch(() => null)) as
          { units?: Candidate[] } | ApiErrorBody | null;
        outcome = response.ok
          ? ((body as { units?: Candidate[] } | null)?.units ?? [])
          : apiError(body as ApiErrorBody | null);
      } catch {
        outcome = networkError;
      }
      if (current !== request.current) return;
      setSearching(false);
      if (typeof outcome === "string") {
        setSearchFailure(outcome);
        setCandidates([]);
      } else {
        setSearchFailure(null);
        setCandidates(outcome);
      }
    }, 250);
  };

  const noResults =
    term.trim().length < 2 ? t("searchHint") : searching ? t("searching") : t("noMatches");

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={chosen !== null}
      send={() =>
        sendJson<{ parentName: string }>(`/api/units/${unit.id}/lineage`, {
          parentUnitId: chosen?.id,
          comment: comment.trim(),
        })
      }
      successTitle={(data) => t("success", { parent: data.parentName })}
      onClose={onClose}
    >
      <Field label={t("parent")} hint={t("searchHint")} required>
        {(control) => (
          <SearchableSelect
            {...control}
            remote
            value={chosen ? String(chosen.id) : ""}
            options={options}
            noneLabel={t("choose")}
            noResultsLabel={noResults}
            countLabel={(count) => t("matches", { count })}
            onQueryChange={search}
            onChange={(value) =>
              setChosen(candidates.find((c) => String(c.id) === value) ?? (value ? chosen : null))
            }
          />
        )}
      </Field>
      {searchFailure ? <Banner tone="danger">{searchFailure}</Banner> : null}
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={NOTE_MAX}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Banner tone="warning">{t("permanent")}</Banner>
    </ActionDialog>
  );
}

/** Moves some of a plant group's plants into a new group, here or in another location. */
export function SplitDialog({ unit, locations, onClose }: DialogProps & { locations: Option[] }) {
  const t = useTranslations("units.actions.split");
  const [plants, setPlants] = useState("");
  const [locationId, setLocationId] = useState(unit.locationId ? String(unit.locationId) : "");
  const [comment, setComment] = useState("");
  const inGroup = unit.plantCount ?? 1;
  const value = Number(plants);
  const valid = Number.isInteger(value) && value >= 1 && value < inGroup && locationId !== "";

  return (
    <ActionDialog<{ unitName: string }>
      title={t("title")}
      description={t("description", { name: unit.name, count: inGroup })}
      submitLabel={t("submit")}
      canSubmit={valid}
      send={() =>
        sendJson(`/api/units/${unit.id}/split`, {
          plants: value,
          locationId: Number(locationId),
          comment: comment.trim() || undefined,
        })
      }
      successTitle={(data) => t("success", { name: data.unitName })}
      onClose={onClose}
    >
      <Field label={t("plants")} hint={t("plantsHint", { count: inGroup - 1 })} required>
        {(control) => (
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={inGroup - 1}
            step={1}
            value={plants}
            onChange={(e) => setPlants(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field label={t("location")} required>
        {(control) => (
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} {...control}>
            <option value="">{t("chooseLocation")}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={2000}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

type MergeTarget = { id: number; name: string; plants: number };

/** The whole group joins another group of the same experiment, cultivar and stage. */
export function MergeDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.merge");
  const [targets, setTargets] = useState<MergeTarget[] | null>(null);
  const [into, setInto] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    let live = true;
    void fetch(`/api/units/${unit.id}/merge`)
      .then((response) => (response.ok ? response.json() : { groups: [] }))
      .then((body: { groups?: MergeTarget[] }) => {
        if (live) setTargets(body.groups ?? []);
      })
      .catch(() => live && setTargets([]));
    return () => {
      live = false;
    };
  }, [unit.id]);

  return (
    <ActionDialog<{ unitName: string; plants: number }>
      title={t("title")}
      description={t("description", { name: unit.name, count: unit.plantCount ?? 1 })}
      submitLabel={t("submit")}
      tone="danger"
      canSubmit={into !== ""}
      send={() =>
        sendJson(`/api/units/${unit.id}/merge`, {
          intoUnitId: Number(into),
          comment: comment.trim() || undefined,
        })
      }
      successTitle={(data) => t("success", { name: data.unitName, count: data.plants })}
      onClose={onClose}
    >
      {targets !== null && targets.length === 0 ? (
        <Banner tone="warning">{t("none")}</Banner>
      ) : null}
      <Field label={t("into")} hint={t("intoHint")} required>
        {(control) => (
          <Select value={into} onChange={(e) => setInto(e.target.value)} {...control}>
            <option value="">{targets === null ? t("loading") : t("choose")}</option>
            {(targets ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {t("option", { name: group.name, count: group.plants })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={2000}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Banner tone="info">{t("next")}</Banner>
    </ActionDialog>
  );
}

const WASTE_TYPES = ["TRIM", "STEMS_LEAVES", "ROOTS", "PLANT_MATTER", "OTHER"] as const;
const WASTE_METHOD_MIN = 3;

/**
 * Disposes of part of the unit as waste, in grams on the basis the unit is weighed on. The unit keeps
 * what is left; the waste is destroyed on the CTLS return.
 */
export function WasteDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.waste");
  const domain = useTranslations("domain");
  const format = useFormatter();
  const [type, setType] = useState<(typeof WASTE_TYPES)[number]>("TRIM");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [comment, setComment] = useState("");

  const dry = unit.dryWeight !== null;
  const available = dry ? unit.dryWeight : unit.humidWeight;
  const value = Number(amount);
  const valid =
    amount.trim() !== "" &&
    value > 0 &&
    available !== null &&
    value < available &&
    method.trim().length >= WASTE_METHOD_MIN;

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={valid}
      send={() =>
        sendJson(`/api/units/${unit.id}/waste`, {
          type,
          amount: value,
          method: method.trim(),
          effectiveAt: effectiveAt || undefined,
          comment: comment.trim() || undefined,
        })
      }
      successTitle={() => t("success", { name: unit.name })}
      onClose={onClose}
    >
      {available === null ? <Banner tone="warning">{t("needsWeight")}</Banner> : null}
      <Field label={t("type")} required>
        {(control) => (
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as (typeof WASTE_TYPES)[number])}
            {...control}
          >
            {WASTE_TYPES.map((id) => (
              <option key={id} value={id}>
                {domain(`wasteType.${id}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={dry ? t("amountDry") : t("amountWet")}
        hint={
          available === null
            ? undefined
            : t("available", { value: format.number(available, "grams") })
        }
        required
      >
        {(control) => (
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field label={t("method")} hint={t("methodHint")} required>
        {(control) => (
          <Input
            value={method}
            maxLength={500}
            autoComplete="off"
            onChange={(e) => setMethod(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field label={t("date")} hint={t("dateHint")}>
        {(control) => (
          <Input
            type="date"
            value={effectiveAt}
            max={toDateInputValue()}
            onChange={(e) => setEffectiveAt(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field label={t("note")}>
        {(control) => (
          <Textarea
            rows={2}
            value={comment}
            maxLength={2000}
            onChange={(e) => setComment(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Banner tone="info">{t("ctls")}</Banner>
    </ActionDialog>
  );
}

export function DestroyDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.destroy");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");

  const allowed = canConfirm({
    reason,
    reasonMinLength: DESTROY_REASON_MIN,
    requireReason: true,
    phrase: unit.name,
    typed,
    pending: false,
  });

  return (
    <ActionDialog
      title={t("title", { name: unit.name })}
      description={t("description")}
      submitLabel={t("submit")}
      tone="danger"
      canSubmit={allowed}
      send={() =>
        sendJson(`/api/units/${unit.id}/destroy`, {
          reason: reason.trim(),
        })
      }
      successTitle={() => t("success")}
      onClose={onClose}
    >
      <Banner tone="danger">{t("irreversible")}</Banner>
      <Field label={t("reason")} hint={t("reasonHint", { count: DESTROY_REASON_MIN })} required>
        {(control) => (
          <Textarea
            rows={3}
            value={reason}
            maxLength={NOTE_MAX}
            onChange={(e) => setReason(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Field label={t("typeToConfirm", { phrase: `“${unit.name}”` })} required>
        {(control) => (
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}
