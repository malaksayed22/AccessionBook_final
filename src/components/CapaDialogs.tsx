"use client";

import { BadgeCheck, CheckCircle2, Plus } from "lucide-react";
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

function useCapaCommand(incidentId: number) {
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const run = async (command: Record<string, unknown>, success: string) => {
    const result = await action.run(() =>
      sendJson(`/api/qa/incidents/${incidentId}/capa`, command)
    );
    if (!result.ok) return false;
    toast({ tone: "success", title: success });
    router.refresh();
    return true;
  };
  return { action, run };
}

/** Raises a corrective or preventive action on the incident. Quality assurance only. */
export function AddCapaButton({
  incidentId,
  members,
  today,
}: {
  incidentId: number;
  members: ReadonlyArray<{ id: number; name: string }>;
  today: string;
}) {
  const t = useTranslations("qa.capa");
  const { action, run } = useCapaCommand(incidentId);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"CORRECTIVE" | "PREVENTIVE">("CORRECTIVE");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [due, setDue] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await run(
      {
        action: "add",
        kind,
        description,
        ownerId: ownerId || undefined,
        dueDate: due || undefined,
      },
      t("added")
    );
    if (done) {
      setOpen(false);
      setDescription("");
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Plus />}
        onClick={() => {
          action.reset();
          setOpen(true);
        }}
      >
        {t("add")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("addTitle")}
        description={t("addDescription")}
        dismissible={!action.pending}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
          <Field label={t("kind")}>
            {(control) => (
              <Select
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
                {...control}
              >
                <option value="CORRECTIVE">{t("kinds.CORRECTIVE")}</option>
                <option value="PREVENTIVE">{t("kinds.PREVENTIVE")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("description")} hint={t("descriptionHint")} required>
            {(control) => (
              <Textarea
                value={description}
                rows={3}
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
                autoFocus
                {...control}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("owner")}>
              {(control) => (
                <Select
                  value={ownerId}
                  onChange={(event) => setOwnerId(event.target.value)}
                  {...control}
                >
                  <option value="">{t("noOwner")}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("due")}>
              {(control) => (
                <Input
                  type="date"
                  min={today}
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                  {...control}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={action.pending}>
              {t("addSubmit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Records an action as done (its owner or quality assurance), or checks that it worked (QA). */
export function CapaStepButton({
  incidentId,
  capaId,
  step,
  description,
}: {
  incidentId: number;
  capaId: number;
  step: "complete" | "verify";
  description: string;
}) {
  const t = useTranslations("qa.capa");
  const { action, run } = useCapaCommand(incidentId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await run(
      { action: step, capaId, note },
      t(step === "complete" ? "completed" : "verified")
    );
    if (done) setOpen(false);
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={step === "complete" ? <CheckCircle2 /> : <BadgeCheck />}
        onClick={() => {
          action.reset();
          setNote("");
          setOpen(true);
        }}
      >
        {t(step === "complete" ? "complete" : "verify")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t(step === "complete" ? "completeTitle" : "verifyTitle")}
        description={description}
        dismissible={!action.pending}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {action.error ? <Banner tone="danger">{action.error}</Banner> : null}
          <Field
            label={t(step === "complete" ? "completeNote" : "verifyNote")}
            hint={t(step === "complete" ? "completeHint" : "verifyHint")}
            required
          >
            {(control) => (
              <Textarea
                value={note}
                rows={3}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                autoFocus
                {...control}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={action.pending}>
              {t(step === "complete" ? "completeSubmit" : "verifySubmit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
