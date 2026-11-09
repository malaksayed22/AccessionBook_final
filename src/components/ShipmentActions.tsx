"use client";

import { Ban, CheckCircle2, Pencil, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

type Props = {
  shipmentId: number;
  reference: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "DRAFT" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
  /** Lines that name a unit: these units leave inventory when an outbound shipment leaves. */
  unitLineCount: number;
  trackingNumber: string | null;
  licenceNumber: string | null;
  /** Only administrators change shipments; everyone else sees why the actions are missing. */
  canManage: boolean;
};

/** Status moves and custody edits for one shipment. Each move is confirmed before it is sent. */
export function ShipmentActions(props: Props) {
  const { shipmentId, reference, direction, status, unitLineCount, canManage } = props;
  const t = useTranslations("materials.actions");
  const url = `/api/shipments/${shipmentId}`;

  const leavingNote =
    direction === "OUTBOUND"
      ? unitLineCount > 0
        ? t("leavingUnits", { count: unitLineCount })
        : t("leavingBulk")
      : t("leavingInbound");

  return (
    <Panel>
      <PanelHeader title={t("title")} />
      <PanelBody className="space-y-3">
        {!canManage ? (
          <p className="text-sm text-fg-secondary">{t("adminOnly")}</p>
        ) : (
          <div className="flex flex-col items-stretch gap-2">
            {status === "DRAFT" ? (
              <ConfirmAction
                label={t("markInTransit")}
                size="md"
                icon={<Truck />}
                url={url}
                method="PATCH"
                body={{ status: "IN_TRANSIT" }}
                title={t("inTransitTitle", { reference })}
                description={
                  <>
                    {t("inTransitBody")} {leavingNote}
                  </>
                }
                confirmLabel={t("markInTransit")}
                tone="primary"
                doneMessage={t("done")}
              />
            ) : null}

            {status === "DRAFT" || status === "IN_TRANSIT" ? (
              <ConfirmAction
                label={t("markDelivered")}
                size="md"
                icon={<CheckCircle2 />}
                url={url}
                method="PATCH"
                body={{ status: "DELIVERED" }}
                title={t("deliveredTitle", { reference })}
                description={
                  <>
                    {t("deliveredBody")} {status === "DRAFT" ? leavingNote : ""}
                  </>
                }
                confirmLabel={t("markDelivered")}
                tone="primary"
                doneMessage={t("done")}
              />
            ) : null}

            {status === "DRAFT" ? (
              <ConfirmAction
                label={t("cancel")}
                size="md"
                icon={<Ban />}
                url={url}
                method="PATCH"
                body={{ status: "CANCELLED" }}
                title={t("cancelTitle", { reference })}
                description={t("cancelBody")}
                confirmLabel={t("cancel")}
                doneMessage={t("done")}
              />
            ) : null}

            {status === "DELIVERED" ? (
              <p className="text-sm text-fg-secondary">{t("finished")}</p>
            ) : null}
          </div>
        )}

        {canManage && status !== "CANCELLED" ? <EditCustody {...props} /> : null}
      </PanelBody>
    </Panel>
  );
}

function EditCustody({ shipmentId, trackingNumber, licenceNumber }: Props) {
  const t = useTranslations("materials.actions.custody");
  const router = useRouter();
  const { toast } = useToast();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState(trackingNumber ?? "");
  const [licence, setLicence] = useState(licenceNumber ?? "");
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure("");
    setPending(true);
    const result = await sendJson(
      `/api/shipments/${shipmentId}`,
      {
        trackingNumber: tracking.trim(),
        licenceNumber: licence.trim(),
      },
      "PATCH"
    );
    setPending(false);
    if (!result.ok) return setFailure(result.network ? networkMessage : describe(result.error));
    toast({ tone: "success", title: t("done") });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setTracking(trackingNumber ?? "");
          setLicence(licenceNumber ?? "");
          setFailure("");
        }
      }}
      title={t("title")}
      description={t("description")}
      trigger={
        <Button variant="secondary" icon={<Pencil />} className="w-full">
          {t("open")}
        </Button>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <Field label={t("tracking")}>
          {(control) => (
            <Input
              {...control}
              value={tracking}
              maxLength={200}
              onChange={(event) => setTracking(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("licence")}>
          {(control) => (
            <Input
              {...control}
              value={licence}
              maxLength={100}
              onChange={(event) => setLicence(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
