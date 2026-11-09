"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { useRequestAction } from "./use-request-action";

export type LocationFormValues = {
  id: number;
  name: string;
  code: string | null;
  address: string | null;
  comment: string | null;
  capacity: number | null;
  capacityMeasure?: "UNITS" | "PLANTS" | "WEIGHT";
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when creating. */
  location?: LocationFormValues;
};

/** Create or edit a room. The form is mounted only while the dialog is open. */
export function LocationFormDialog({ open, onOpenChange, location }: Props) {
  const t = useTranslations("locations.form");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={location ? t("editTitle", { name: location.name }) : t("createTitle")}
      description={location ? t("editDescription") : t("createDescription")}
    >
      <LocationForm location={location} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function LocationForm({
  location,
  onClose,
}: {
  location?: LocationFormValues;
  onClose: () => void;
}) {
  const t = useTranslations("locations.form");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();

  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [measure, setMeasure] = useState<"UNITS" | "PLANTS" | "WEIGHT">(
    location?.capacityMeasure ?? "UNITS"
  );
  // A weight is typed in kilograms and kept in grams.
  const [capacity, setCapacity] = useState(
    location?.capacity == null
      ? ""
      : String(measure === "WEIGHT" ? location.capacity / 1000 : location.capacity)
  );
  const [comment, setComment] = useState(location?.comment ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const typed = capacity.trim() === "" ? null : Number(capacity.replace(",", "."));
    const parsed =
      typed === null || Number.isNaN(typed)
        ? typed
        : measure === "WEIGHT"
          ? Math.round(typed * 1000)
          : typed;
    const badName = trimmed.length < 2 ? t("nameRequired") : null;
    const badCapacity =
      parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000)
        ? t(measure === "WEIGHT" ? "capacityKgInvalid" : "capacityInvalid")
        : null;
    setNameError(badName);
    setCapacityError(badCapacity);
    if (badName || badCapacity) return;

    const body = {
      name: trimmed,
      address,
      comment,
      capacity: parsed,
      capacityMeasure: measure,
    };
    const result = await action.run(() =>
      location
        ? sendJson(`/api/locations/${location.id}`, { action: "update", ...body }, "PATCH")
        : sendJson("/api/locations", body)
    );
    if (!result.ok) return;
    toast({
      tone: "success",
      title: location ? t("savedTitle", { name: trimmed }) : t("createdTitle", { name: trimmed }),
    });
    router.refresh();
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {action.error ? <Banner tone="danger">{action.error}</Banner> : null}

      <Field label={t("name")} error={nameError} required>
        {(control) => (
          <Input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            autoComplete="off"
            {...control}
          />
        )}
      </Field>

      <Field label={t("comment")} hint={t("descriptionHint")}>
        {(control) => (
          <Textarea
            name="comment"
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            {...control}
          />
        )}
      </Field>

      <Field label={t("address")} hint={t("addressHint")}>
        {(control) => (
          <Input
            name="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            maxLength={500}
            autoComplete="off"
            {...control}
          />
        )}
      </Field>

      <Field label={t("capacityMeasure")}>
        {(control) => (
          <Select
            value={measure}
            onChange={(event) => setMeasure(event.target.value as "UNITS" | "PLANTS" | "WEIGHT")}
            {...control}
          >
            <option value="UNITS">{t("measureUnits")}</option>
            <option value="PLANTS">{t("measurePlants")}</option>
            <option value="WEIGHT">{t("measureWeight")}</option>
          </Select>
        )}
      </Field>

      <Field
        label={t(measure === "WEIGHT" ? "capacityKg" : "capacity")}
        hint={t(measure === "WEIGHT" ? "capacityKgHint" : "capacityHint")}
        error={capacityError}
      >
        {(control) => (
          <Input
            name="capacity"
            type="number"
            inputMode={measure === "WEIGHT" ? "decimal" : "numeric"}
            min={measure === "WEIGHT" ? 0.001 : 1}
            step={measure === "WEIGHT" ? "any" : 1}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            {...control}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={action.pending}>
          {t("cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={action.pending}>
          {location ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}
