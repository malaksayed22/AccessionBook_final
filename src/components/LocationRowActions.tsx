"use client";

import { EllipsisVertical, Pencil, Power, PowerOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/DropdownMenu";
import { IconButton } from "@/components/ui/IconButton";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { canRetireLocation } from "@/lib/location-capacity";
import { LocationFormDialog, type LocationFormValues } from "./LocationFormDialog";
import { useRequestAction } from "./use-request-action";

type Props = {
  location: LocationFormValues & { active: boolean; units: number };
};

/** Row menu: edit, retire (only while empty, with a reason) and reactivate. Administrators only. */
export function LocationRowActions({ location }: Props) {
  const t = useTranslations("locations.actions");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"retire" | "reactivate" | null>(null);
  const emptyEnough = canRetireLocation(location.units);

  function open(kind: "retire" | "reactivate") {
    action.reset();
    setConfirm(kind);
  }

  async function run(kind: "retire" | "reactivate", reason: string) {
    const body = kind === "retire" ? { action: "retire", reason } : { action: "reactivate" };
    const result = await action.run(() => sendJson(`/api/locations/${location.id}`, body, "PATCH"));
    if (!result.ok) return;
    toast({
      tone: "success",
      title: t(kind === "retire" ? "retiredTitle" : "reactivatedTitle", { name: location.name }),
    });
    setConfirm(null);
    router.refresh();
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={t("menu", { name: location.name })} size="sm">
            <EllipsisVertical />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>{location.name}</MenuLabel>
          <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
            {t("edit")}
          </MenuItem>
          {location.active ? (
            <MenuItem
              icon={<PowerOff />}
              tone="danger"
              disabled={!emptyEnough}
              onSelect={() => open("retire")}
            >
              {emptyEnough ? t("retire") : t("retireBlocked", { units: location.units })}
            </MenuItem>
          ) : (
            <MenuItem icon={<Power />} onSelect={() => open("reactivate")}>
              {t("reactivate")}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>

      <LocationFormDialog open={editing} onOpenChange={setEditing} location={location} />

      <ConfirmDialog
        open={confirm === "retire"}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={t("retireTitle", { name: location.name })}
        description={t("retireBody")}
        confirmLabel={t("retireConfirm")}
        requireReason
        reasonHint={t("reasonHint")}
        pending={action.pending}
        error={action.error}
        onConfirm={({ reason }) => {
          void run("retire", reason);
        }}
      />
      <ConfirmDialog
        open={confirm === "reactivate"}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={t("reactivateTitle", { name: location.name })}
        description={t("reactivateBody")}
        confirmLabel={t("reactivateConfirm")}
        tone="primary"
        pending={action.pending}
        error={action.error}
        onConfirm={() => {
          void run("reactivate", "");
        }}
      />
    </>
  );
}
