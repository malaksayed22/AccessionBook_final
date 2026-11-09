"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import { sendJson } from "@/lib/client-api";
import { toDateInputValue } from "@/lib/format";
import { ACTIVITY_TYPE_CHOICES } from "@/features/action/forms";
import { STAGE_OPTION_IDS } from "@/lib/unit-action-constants";
import { planBulk, type BulkAction, type BulkPlan } from "@/lib/unit-bulk";
import { ActionDialog } from "./ActionDialog";
import { AddLocation } from "./AddLocation";
import type { Option } from "./action-types";
import { useSelection } from "./BulkSelection";

const NOTE_MAX = 2000;
const DESTROY_REASON_MIN = 10;
const RELEASE_REASON_MIN = 10;

/** How many of the selection a form will touch, and what it leaves out and why. */
function Summary({ plan, total }: { plan: BulkPlan; total: number }) {
  const t = useTranslations("units.bulk");
  const reasons = Object.entries(plan.skipped)
    .map(([reason, count]) => t(`skipped.${reason as "held"}`, { count }))
    .join(", ");
  if (plan.eligible.length === 0) return <Banner tone="warning">{t("none")}</Banner>;
  return (
    <Banner tone="info">
      <p>{t("applies", { eligible: plan.eligible.length, total })}</p>
      {plan.skippedCount > 0 ? <p>{t("leftOut", { reasons })}</p> : null}
      <p>{t("allOrNothing")}</p>
    </Banner>
  );
}

/** The form for one bulk action over the units selected on the page. */
export function BulkDialog({ action, onClose }: { action: BulkAction; onClose: () => void }) {
  const { selectedUnits, clear, locations, canAddLocation } = useSelection();
  const [addedLocations, setAddedLocations] = useState<Option[]>([]);
  const allLocations = [...locations, ...addedLocations];
  const total = selectedUnits.length;

  // What the person chose can rule out more units (already in that room, already in that stage).
  const [toLocation, setToLocation] = useState("");
  const [toStage, setToStage] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [activity, setActivity] = useState({
    type: "PESTICIDE",
    title: "",
    product: "",
    pcpNumber: "",
    amount: "",
    amountUnit: "",
    method: "",
  });
  const setField = (key: keyof typeof activity) => (value: string) =>
    setActivity((current) => ({ ...current, [key]: value }));

  const plan = planBulk(action, selectedUnits, {
    toLocationId: toLocation ? Number(toLocation) : null,
    toStage: toStage || null,
  });
  const unitIds = plan.eligible.map((u) => u.id);
  const count = unitIds.length;
  const hasUnits = count > 0;

  const t = useTranslations(`units.bulk.${action}`);
  const domain = useTranslations("domain");

  const done = () => clear();
  const send = (body: Record<string, unknown>) =>
    sendJson<{ count: number }>("/api/units/bulk", { action, unitIds, ...body });

  if (action === "move") {
    return (
      <ActionDialog
        title={t("title", { count: hasUnits ? count : total })}
        description={t("description")}
        submitLabel={t("submit")}
        canSubmit={hasUnits && toLocation !== ""}
        send={() =>
          send({ toLocationId: Number(toLocation), comment: comment.trim() || undefined })
        }
        successTitle={(data) => t("success", { count: data.count })}
        onDone={done}
        onClose={onClose}
      >
        <Summary plan={plan} total={total} />
        <Field label={t("destination")} required>
          {(control) => (
            <Select value={toLocation} onChange={(e) => setToLocation(e.target.value)} {...control}>
              <option value="">{t("choose")}</option>
              {allLocations.map((l) => (
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
              setAddedLocations((current) => [...current, location]);
              setToLocation(String(location.id));
            }}
          />
        ) : null}
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

  if (action === "stage") {
    return (
      <ActionDialog
        title={t("title", { count: hasUnits ? count : total })}
        description={t("description")}
        submitLabel={t("submit")}
        canSubmit={hasUnits && toStage !== ""}
        send={() =>
          send({
            toStage,
            effectiveAt: effectiveAt || undefined,
            comment: comment.trim() || undefined,
          })
        }
        successTitle={(data) => t("success", { count: data.count })}
        onDone={done}
        onClose={onClose}
      >
        <Summary plan={plan} total={total} />
        <Field label={t("newStage")} required>
          {(control) => (
            <Select value={toStage} onChange={(e) => setToStage(e.target.value)} {...control}>
              <option value="">{t("choose")}</option>
              {STAGE_OPTION_IDS.map((id) => (
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

  if (action === "activity") {
    // A pesticide needs its product, PCP registration number and amount; insects their species and count.
    const needsProduct = activity.type === "PESTICIDE" || activity.type === "BENEFICIAL_INSECTS";
    const needsPcp = activity.type === "PESTICIDE";
    const amountOk = activity.amount === "" ? !needsProduct : Number(activity.amount) > 0;
    const complete =
      activity.title.trim() !== "" &&
      (!needsProduct || activity.product.trim() !== "") &&
      (!needsPcp || activity.pcpNumber.trim() !== "") &&
      amountOk &&
      (activity.amount === "" || activity.amountUnit.trim() !== "");
    const text = (key: keyof typeof activity) => activity[key].trim() || undefined;
    return (
      <ActionDialog
        title={t("title", { count: hasUnits ? count : total })}
        description={t("description")}
        submitLabel={t("submit")}
        canSubmit={hasUnits && complete}
        send={() =>
          send({
            type: activity.type,
            title: activity.title.trim(),
            product: text("product"),
            pcpNumber: needsPcp ? text("pcpNumber") : undefined,
            amount: activity.amount === "" ? undefined : Number(activity.amount),
            amountUnit: activity.amount === "" ? undefined : text("amountUnit"),
            method: text("method"),
            effectiveAt: effectiveAt || undefined,
            details: comment.trim() || undefined,
          })
        }
        successTitle={(data) => t("success", { count: data.count })}
        onDone={done}
        onClose={onClose}
      >
        <Summary plan={plan} total={total} />
        <Field label={t("type")} required>
          {(control) => (
            <Select
              value={activity.type}
              onChange={(e) => setField("type")(e.target.value)}
              {...control}
            >
              {ACTIVITY_TYPE_CHOICES.map((id) => (
                <option key={id} value={id}>
                  {domain(`activityType.${id}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("activityTitle")} hint={t("activityTitleHint")} required>
          {(control) => (
            <Input
              value={activity.title}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setField("title")(e.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("product")} hint={t("productHint")} required={needsProduct}>
          {(control) => (
            <Input
              value={activity.product}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setField("product")(e.target.value)}
              {...control}
            />
          )}
        </Field>
        {needsPcp ? (
          <Field label={t("pcpNumber")} hint={t("pcpNumberHint")} required>
            {(control) => (
              <Input
                value={activity.pcpNumber}
                maxLength={40}
                autoComplete="off"
                onChange={(e) => setField("pcpNumber")(e.target.value)}
                {...control}
              />
            )}
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("amount")} hint={t("amountHint")} required={needsProduct}>
            {(control) => (
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={activity.amount}
                onChange={(e) => setField("amount")(e.target.value)}
                {...control}
              />
            )}
          </Field>
          <Field
            label={t("amountUnit")}
            hint={t("amountUnitHint")}
            required={activity.amount !== ""}
          >
            {(control) => (
              <Input
                value={activity.amountUnit}
                maxLength={20}
                autoComplete="off"
                onChange={(e) => setField("amountUnit")(e.target.value)}
                {...control}
              />
            )}
          </Field>
        </div>
        <Field label={t("method")} hint={t("methodHint")}>
          {(control) => (
            <Input
              value={activity.method}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setField("method")(e.target.value)}
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
              maxLength={NOTE_MAX}
              onChange={(e) => setComment(e.target.value)}
              {...control}
            />
          )}
        </Field>
      </ActionDialog>
    );
  }

  if (action === "release") {
    return (
      <ActionDialog
        title={t("title", { count: hasUnits ? count : total })}
        description={t("description")}
        submitLabel={t("submit")}
        canSubmit={hasUnits && reason.trim().length >= RELEASE_REASON_MIN}
        send={() => send({ reason: reason.trim() })}
        successTitle={(data) => t("success", { count: data.count })}
        onDone={done}
        onClose={onClose}
      >
        <Summary plan={plan} total={total} />
        <Field label={t("reason")} hint={t("reasonHint", { count: RELEASE_REASON_MIN })} required>
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
      </ActionDialog>
    );
  }

  if (action === "hold") {
    return (
      <ActionDialog
        title={t("title", { count: hasUnits ? count : total })}
        description={t("description")}
        submitLabel={t("submit")}
        canSubmit={hasUnits && reason.trim().length >= 3}
        send={() => send({ reason: reason.trim() })}
        successTitle={(data) => t("success", { count: data.count })}
        onDone={done}
        onClose={onClose}
      >
        <Summary plan={plan} total={total} />
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

  return (
    <ActionDialog
      title={t("title", { count: hasUnits ? count : total })}
      description={t("description")}
      submitLabel={t("submit")}
      tone="danger"
      canSubmit={hasUnits && reason.trim().length >= DESTROY_REASON_MIN}
      send={() => send({ reason: reason.trim() })}
      successTitle={(data) => t("success", { count: data.count })}
      onDone={done}
      onClose={onClose}
    >
      <Summary plan={plan} total={total} />
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
    </ActionDialog>
  );
}
