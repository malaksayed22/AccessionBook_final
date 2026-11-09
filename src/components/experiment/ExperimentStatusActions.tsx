"use client";

import { CircleCheck, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

/**
 * An experiment is running until it is completed; completing it records the day it finished.
 * Members of the experiment and administrators complete it; only administrators reopen it.
 */
export function ExperimentStatusActions({
  experimentId,
  status,
  startDate,
  today,
  canComplete,
  canReopen,
}: {
  experimentId: number;
  status: "active" | "completed";
  /** `YYYY-MM-DD`: a completion date cannot be before it. */
  startDate: string;
  /** `YYYY-MM-DD`: today in the laboratory's time zone, the latest completion date. */
  today: string;
  canComplete: boolean;
  canReopen: boolean;
}) {
  const t = useTranslations("experiments.status");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const networkError = useNetworkError();

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  async function send(body: { action: "complete"; endDate: string } | { action: "reopen" }) {
    setPending(true);
    setFailure(null);
    const result = await sendJson(`/api/experiments/${experimentId}/status`, body);
    setPending(false);
    if (!result.ok) {
      setFailure(result.network ? networkError : apiError(result.error));
      return false;
    }
    return true;
  }

  async function complete(event: FormEvent) {
    event.preventDefault();
    if (!date || date < startDate || date > today) {
      setFailure(t("dateInvalid"));
      return;
    }
    if (await send({ action: "complete", endDate: date })) {
      toast({ tone: "success", title: t("completed") });
      setOpen(false);
      router.refresh();
    }
  }

  if (status === "active" && canComplete) {
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setDate(today);
            setFailure(null);
          }
        }}
        trigger={
          <Button variant="secondary" icon={<CircleCheck />}>
            {t("complete")}
          </Button>
        }
        title={t("completeTitle")}
        description={t("completeBody")}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" disabled={pending}>
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" form="complete-experiment" variant="primary" loading={pending}>
              {t("confirmComplete")}
            </Button>
          </>
        }
      >
        <form id="complete-experiment" onSubmit={complete} noValidate className="space-y-4">
          {failure ? <Banner tone="danger">{failure}</Banner> : null}
          <Field label={t("completionDate")} hint={t("completionDateHint")} required>
            {(control) => (
              <Input
                type="date"
                value={date}
                min={startDate}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                {...control}
              />
            )}
          </Field>
        </form>
      </Dialog>
    );
  }

  if (status === "completed" && canReopen) {
    return (
      <>
        <Button variant="secondary" icon={<RotateCcw />} onClick={() => setReopening(true)}>
          {t("reopen")}
        </Button>
        {reopening ? (
          <ConfirmDialog
            open
            onOpenChange={(next) => {
              if (!next) {
                setReopening(false);
                setFailure(null);
              }
            }}
            title={t("reopenTitle")}
            description={t("reopenBody")}
            confirmLabel={t("confirmReopen")}
            tone="primary"
            pending={pending}
            error={failure}
            onConfirm={() => {
              void send({ action: "reopen" }).then((ok) => {
                if (!ok) return;
                toast({ tone: "success", title: t("reopened") });
                setReopening(false);
                router.refresh();
              });
            }}
          />
        ) : null}
      </>
    );
  }

  return null;
}
