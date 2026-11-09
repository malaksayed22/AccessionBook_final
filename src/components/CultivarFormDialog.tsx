"use client";

import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { useRequestAction } from "./use-request-action";

export type CultivarFormValues = {
  id: number;
  name: string;
  code: string | null;
  commonName: string | null;
  category: string | null;
  targetThc: number | null;
  vegetativeDays?: number | null;
  floweringDays?: number | null;
  expectedYieldGrams?: number | null;
  targetCbd: number | null;
  comment: string | null;
};

/** "Add cultivar" (no props) or "Edit" (with the current values). Administrators only. */
export function CultivarFormButton({ cultivar }: { cultivar?: CultivarFormValues }) {
  const t = useTranslations("cultivars.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={cultivar ? "secondary" : "primary"}
        icon={cultivar ? <Pencil /> : <Plus />}
        onClick={() => setOpen(true)}
      >
        {cultivar ? t("editButton") : t("createButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={cultivar ? t("editTitle", { name: cultivar.name }) : t("createTitle")}
        description={cultivar ? t("editDescription") : t("createDescription")}
      >
        <CultivarForm cultivar={cultivar} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

/** A percentage typed in a number field: empty means unknown, otherwise 0 to 100. */
function parsePercent(text: string): { value: number | null; valid: boolean } {
  if (text.trim() === "") return { value: null, valid: true };
  const value = Number(text);
  return { value, valid: Number.isFinite(value) && value >= 0 && value <= 100 };
}

function CultivarForm({
  cultivar,
  onClose,
}: {
  cultivar?: CultivarFormValues;
  onClose: () => void;
}) {
  const t = useTranslations("cultivars.form");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();

  const [name, setName] = useState(cultivar?.name ?? "");
  const [commonName, setCommonName] = useState(cultivar?.commonName ?? "");
  const [category, setCategory] = useState(cultivar?.category ?? "");
  const [thc, setThc] = useState(cultivar?.targetThc?.toString() ?? "");
  const [cbd, setCbd] = useState(cultivar?.targetCbd?.toString() ?? "");
  const [vegDays, setVegDays] = useState(cultivar?.vegetativeDays?.toString() ?? "");
  const [flowerDays, setFlowerDays] = useState(cultivar?.floweringDays?.toString() ?? "");
  const [yieldGrams, setYieldGrams] = useState(cultivar?.expectedYieldGrams?.toString() ?? "");
  const [comment, setComment] = useState(cultivar?.comment ?? "");
  const [errors, setErrors] = useState<{ name?: string; thc?: string; cbd?: string }>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const thcValue = parsePercent(thc);
    const cbdValue = parsePercent(cbd);
    const next = {
      name: trimmed.length < 2 ? t("nameRequired") : undefined,
      thc: thcValue.valid ? undefined : t("percentInvalid"),
      cbd: cbdValue.valid ? undefined : t("percentInvalid"),
    };
    setErrors(next);
    if (next.name || next.thc || next.cbd) return;

    const body = {
      name: trimmed,
      commonName,
      category,
      targetThc: thcValue.value,
      targetCbd: cbdValue.value,
      vegetativeDays: vegDays.trim() === "" ? null : Number(vegDays),
      floweringDays: flowerDays.trim() === "" ? null : Number(flowerDays),
      expectedYieldGrams: yieldGrams.trim() === "" ? null : Number(yieldGrams),
      comment,
    };
    const result = await action.run(() =>
      cultivar
        ? sendJson(`/api/cultivars/${cultivar.id}`, body, "PATCH")
        : sendJson("/api/cultivars", body)
    );
    if (!result.ok) return;
    toast({
      tone: "success",
      title: cultivar ? t("savedTitle", { name: trimmed }) : t("createdTitle", { name: trimmed }),
    });
    router.refresh();
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {action.error ? <Banner tone="danger">{action.error}</Banner> : null}

      <Field label={t("name")} error={errors.name} required>
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

      <div className="grid gap-4">
        <Field label={t("category")} hint={t("categoryHint")}>
          {(control) => (
            <Input
              name="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={60}
              autoComplete="off"
              {...control}
            />
          )}
        </Field>
      </div>

      <Field label={t("commonName")}>
        {(control) => (
          <Input
            name="commonName"
            value={commonName}
            onChange={(event) => setCommonName(event.target.value)}
            maxLength={120}
            autoComplete="off"
            {...control}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("targetThc")} hint={t("percentHint")} error={errors.thc}>
          {(control) => (
            <Input
              name="targetThc"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={thc}
              onChange={(event) => setThc(event.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("targetCbd")} hint={t("percentHint")} error={errors.cbd}>
          {(control) => (
            <Input
              name="targetCbd"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={cbd}
              onChange={(event) => setCbd(event.target.value)}
              {...control}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("vegetativeDays")} hint={t("daysHint")}>
          {(control) => (
            <Input
              name="vegetativeDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              value={vegDays}
              onChange={(event) => setVegDays(event.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("floweringDays")} hint={t("daysHint")}>
          {(control) => (
            <Input
              name="floweringDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              value={flowerDays}
              onChange={(event) => setFlowerDays(event.target.value)}
              {...control}
            />
          )}
        </Field>
        <Field label={t("expectedYield")} hint={t("expectedYieldHint")}>
          {(control) => (
            <Input
              name="expectedYieldGrams"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={yieldGrams}
              onChange={(event) => setYieldGrams(event.target.value)}
              {...control}
            />
          )}
        </Field>
      </div>

      <Field label={t("comment")}>
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

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={action.pending}>
          {t("cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={action.pending}>
          {cultivar ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}
