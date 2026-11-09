"use client";

import { PackageCheck, Sprout } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ActionDialog } from "@/components/actions/ActionDialog";
import type { ActionContext } from "@/components/actions/types";
import { Button } from "@/components/ui/Button";
import type { ActionId } from "@/lib/action-catalog";

/*
 * Usage: <CreateUnitsButtons /> on the units list, or
 *        <CreateUnitsButtons experiment={{ id, ecode, name }} /> on an experiment's page.
 * "Register units" and "Receive units" as ordinary header buttons; each opens the action dialog
 * straight on its form, for the whole laboratory or for one experiment.
 */
export function CreateUnitsButtons({
  experiment,
}: {
  experiment?: { id: number; ecode: string; name: string; canEdit: boolean };
}) {
  const t = useTranslations("actions.items");
  const [open, setOpen] = useState<ActionId | null>(null);
  const context: ActionContext = experiment
    ? {
        scope: "experiment",
        experimentId: experiment.id,
        experimentCode: experiment.ecode,
        experimentName: experiment.name,
        canEdit: experiment.canEdit,
      }
    : { scope: "global", canEdit: true };

  const button = (action: ActionId, icon: React.ReactNode, variant: "primary" | "secondary") => (
    <ActionDialog
      key={action}
      context={context}
      initialAction={action}
      open={open === action}
      onOpenChange={(next) => setOpen(next ? action : null)}
      trigger={
        <Button variant={variant} icon={icon}>
          {t(`${action}.title`)}
        </Button>
      }
    />
  );

  return (
    <>
      {button("receive_units", <PackageCheck />, "secondary")}
      {button("register_units", <Sprout />, "primary")}
    </>
  );
}
