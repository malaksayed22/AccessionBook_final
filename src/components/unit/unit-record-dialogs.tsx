"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import type { ApiErrorBody } from "@/lib/api-error";
import { sendJson, type ApiResult } from "@/lib/client-api";
import { toDateInputValue } from "@/lib/format";
import {
  ATTACHMENT_CATEGORY_IDS,
  INCIDENT_SEVERITY_IDS,
  TEST_PANEL_IDS,
} from "@/lib/unit-action-constants";
import { ActionDialog } from "./ActionDialog";
import type { DialogProps } from "./action-types";

/*
 * Forms for the records that do not change the unit's custody: quality hold, lab result, incident,
 * activity and document. A hold does not block any of them; only a unit that has left inventory does.
 */

const NOTE_MAX = 2000;
const HOLD_REASON_MIN = 3;

export function HoldDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.hold");
  const [reason, setReason] = useState("");

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={reason.trim().length >= HOLD_REASON_MIN}
      send={() =>
        sendJson(`/api/units/${unit.id}/hold`, {
          action: "hold",
          kind: "HOLD",
          reason: reason.trim(),
        })
      }
      successTitle={() => t("success")}
      onClose={onClose}
    >
      <Field label={t("reason")} hint={t("reasonHint")} required>
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
      <Banner tone="info">{t("next")}</Banner>
    </ActionDialog>
  );
}

export function TestDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.test");
  const domain = useTranslations("domain");
  const [panel, setPanel] = useState<(typeof TEST_PANEL_IDS)[number]>("POTENCY");
  const [value, setValue] = useState("");
  const [wetWeight, setWetWeight] = useState("");
  const [dryWeight, setDryWeight] = useState("");
  const [lab, setLab] = useState("");
  const [testedAt, setTestedAt] = useState("");
  const [comment, setComment] = useState("");
  const [sampleId, setSampleId] = useState("");
  const samples = unit.tissueSamples ?? [];

  // A result is a number, a weight, or a description of it (for example "not detected") in the note.
  const complete =
    value.trim() !== "" ||
    wetWeight.trim() !== "" ||
    dryWeight.trim() !== "" ||
    comment.trim() !== "";
  const optionalNumber = (text: string) => (text.trim() === "" ? undefined : Number(text));

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      size="lg"
      canSubmit={complete}
      send={() =>
        sendJson(`/api/units/${unit.id}/tests`, {
          panel,
          value: optionalNumber(value),
          wetWeight: optionalNumber(wetWeight),
          dryWeight: optionalNumber(dryWeight),
          labName: lab.trim() || undefined,
          testedAt: testedAt || undefined,
          comment: comment.trim() || undefined,
          tissueSampleId: sampleId || undefined,
        })
      }
      successTitle={() => t("success")}
      onClose={onClose}
    >
      {samples.length > 0 ? (
        <Field label={t("sample")} hint={t("sampleHint")}>
          {(control) => (
            <Select value={sampleId} onChange={(e) => setSampleId(e.target.value)} {...control}>
              <option value="">{t("sampleNone")}</option>
              {samples.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.code}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("panel")} required>
          {(control) => (
            <Select
              value={panel}
              onChange={(e) => setPanel(e.target.value as typeof panel)}
              {...control}
            >
              {TEST_PANEL_IDS.map((id) => (
                <option key={id} value={id}>
                  {domain(`testPanel.${id}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("value")} hint={t("valueHint")}>
          {(control) => (
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("wetWeight")}>
          {(control) => (
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={wetWeight}
              onChange={(e) => setWetWeight(e.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("dryWeight")}>
          {(control) => (
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={dryWeight}
              onChange={(e) => setDryWeight(e.target.value)}
              {...control}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("lab")}>
          {(control) => (
            <Input
              value={lab}
              maxLength={200}
              onChange={(e) => setLab(e.target.value)}
              autoComplete="off"
              {...control}
            />
          )}
        </Field>
        <Field label={t("testedOn")} hint={t("testedOnHint")}>
          {(control) => (
            <Input
              type="date"
              value={testedAt}
              max={toDateInputValue()}
              onChange={(e) => setTestedAt(e.target.value)}
              {...control}
            />
          )}
        </Field>
      </div>
      <Field label={t("note")} hint={t("noteHint")}>
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

const SAMPLE_KINDS = ["RELEASE", "RETENTION", "INTERNAL_QA"] as const;

/**
 * Takes part of a flower (by weight, on the basis it is weighed on) or of a seed lot (by count) as a
 * sample. The sample becomes a unit of its own; the unit keeps what is left.
 */
export function SampleDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.sample");
  const domain = useTranslations("domain");
  const format = useFormatter();
  const [kind, setKind] = useState<(typeof SAMPLE_KINDS)[number]>("RELEASE");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");

  const byCount = unit.type === "SEEDLOT";
  const dry = !byCount && unit.dryWeight !== null;
  const available = byCount ? unit.seedCount : dry ? unit.dryWeight : unit.humidWeight;
  const value = Number(amount);
  const valid =
    amount.trim() !== "" &&
    value > 0 &&
    (!byCount || Number.isInteger(value)) &&
    available !== null &&
    value < available;

  return (
    <ActionDialog<{ unitName: string }>
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={valid}
      send={() =>
        sendJson(`/api/units/${unit.id}/samples`, {
          kind,
          amount: value,
          comment: comment.trim() || undefined,
        })
      }
      successTitle={(data) => t("success", { name: data.unitName })}
      onClose={onClose}
    >
      {available === null ? <Banner tone="warning">{t("needsQuantity")}</Banner> : null}
      <Field label={t("kind")} hint={t(`kindHints.${kind}`)} required>
        {(control) => (
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof SAMPLE_KINDS)[number])}
            {...control}
          >
            {SAMPLE_KINDS.map((id) => (
              <option key={id} value={id}>
                {domain(`sampleKind.${id}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={byCount ? t("amountSeeds") : dry ? t("amountDry") : t("amountWet")}
        hint={
          available === null
            ? undefined
            : t(byCount ? "availableSeeds" : "availableGrams", {
                value: format.number(available, byCount ? "count" : "grams"),
              })
        }
        required
      >
        {(control) => (
          <Input
            type="number"
            inputMode={byCount ? "numeric" : "decimal"}
            min={0}
            step={byCount ? 1 : "any"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
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

/**
 * Reports an incident on the unit. `weightMistake` is the same report about a weight on record that is
 * wrong: members cannot change a weight once it is recorded, so the administrator who reads the
 * incident corrects it.
 */
export function IncidentDialog({
  unit,
  weightMistake = false,
  onClose,
}: DialogProps & { weightMistake?: boolean }) {
  const t = useTranslations("units.actions.incident");
  const domain = useTranslations("domain");
  const [title, setTitle] = useState(
    weightMistake ? t("weightMistakeTitle", { name: unit.name }) : ""
  );
  const [severity, setSeverity] = useState<(typeof INCIDENT_SEVERITY_IDS)[number]>(
    weightMistake ? "MINOR" : "MAJOR"
  );
  const [description, setDescription] = useState("");

  return (
    <ActionDialog
      title={weightMistake ? t("weightMistake") : t("title")}
      description={
        weightMistake
          ? t("weightMistakeDescription", { name: unit.name })
          : t("description", { name: unit.name })
      }
      submitLabel={t("submit")}
      canSubmit={title.trim() !== "" && description.trim() !== ""}
      send={() =>
        sendJson<{ autoHeld: boolean }>("/api/qa/incidents", {
          title: title.trim(),
          description: description.trim(),
          severity,
          unitId: unit.id,
        })
      }
      successTitle={(data) => (data.autoHeld ? t("successHeld") : t("success"))}
      onClose={onClose}
    >
      <Field label={t("name")} required>
        {(control) => (
          <Input
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
            {...control}
          />
        )}
      </Field>
      <Field label={t("severity")} hint={t("severityHint")} required>
        {(control) => (
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            {...control}
          >
            {INCIDENT_SEVERITY_IDS.map((id) => (
              <option key={id} value={id}>
                {domain(`incidentSeverity.${id}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("details")} required>
        {(control) => (
          <Textarea
            rows={4}
            value={description}
            maxLength={5000}
            onChange={(e) => setDescription(e.target.value)}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

/** Documents travel as multipart form data, which `sendJson` does not do; same result contract. */
async function sendForm<T>(url: string, body: FormData): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body });
  } catch {
    return { ok: false, error: null, network: true };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data as ApiErrorBody | null, network: false };
  return { ok: true, data: data as T };
}

export function UploadDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.upload");
  const domain = useTranslations("domain");
  const [category, setCategory] = useState<(typeof ATTACHMENT_CATEGORY_IDS)[number]>("PHOTO");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);

  return (
    <ActionDialog
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit={label.trim() !== "" && file !== null}
      send={() => {
        const form = new FormData();
        if (file) form.append("file", file);
        form.append("label", label.trim());
        form.append("category", category);
        return sendForm<{ ok: true }>(`/api/units/${unit.id}/attachments`, form);
      }}
      successTitle={() => t("success")}
      onClose={onClose}
    >
      <Field label={t("category")} required>
        {(control) => (
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            {...control}
          >
            {ATTACHMENT_CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>
                {domain(`attachmentCategory.${id}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("label")} hint={t("labelHint")} required>
        {(control) => (
          <Input
            value={label}
            maxLength={200}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
            {...control}
          />
        )}
      </Field>
      <Field label={t("file")} hint={t("fileHint")} required>
        {(control) => (
          <Input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.docx,.xlsx,application/pdf,image/png,image/jpeg,image/webp,text/csv,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            {...control}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

const TISSUE_PURPOSES = ["PATHOGEN", "SEX", "IDENTITY", "OTHER"] as const;
const TISSUE_KINDS = ["LEAF", "PETIOLE", "ROOT", "MERISTEM", "MEDIUM", "OTHER"] as const;

/**
 * Takes a tissue sample of a plant or a culture for a lab test. The unit's stock does not change;
 * the sample gets a code and a label, and its results are recorded on it.
 */
export function TissueSampleDialog({ unit, onClose }: DialogProps) {
  const t = useTranslations("units.actions.tissue");
  const domain = useTranslations("domain");
  const [purpose, setPurpose] = useState<(typeof TISSUE_PURPOSES)[number]>("PATHOGEN");
  const [tissue, setTissue] = useState<(typeof TISSUE_KINDS)[number]>(
    unit.type === "CULTURE" ? "MEDIUM" : "LEAF"
  );
  const [note, setNote] = useState("");

  return (
    <ActionDialog<{ sample: { code: string } }>
      title={t("title")}
      description={t("description", { name: unit.name })}
      submitLabel={t("submit")}
      canSubmit
      send={() =>
        sendJson(`/api/units/${unit.id}/tissue-samples`, {
          purpose,
          tissue,
          note: note.trim() || undefined,
        })
      }
      successTitle={(data) => t("success", { code: data.sample.code })}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("purpose")} required>
          {(control) => (
            <Select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as typeof purpose)}
              {...control}
            >
              {TISSUE_PURPOSES.map((id) => (
                <option key={id} value={id}>
                  {domain(`tissuePurpose.${id}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("tissue")} required>
          {(control) => (
            <Select
              value={tissue}
              onChange={(e) => setTissue(e.target.value as typeof tissue)}
              {...control}
            >
              {TISSUE_KINDS.map((id) => (
                <option key={id} value={id}>
                  {domain(`tissueKind.${id}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t("note")} hint={t("noteHint")}>
        {(control) => (
          <Textarea
            rows={2}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            {...control}
          />
        )}
      </Field>
      <Banner tone="info">{t("next")}</Banner>
    </ActionDialog>
  );
}
