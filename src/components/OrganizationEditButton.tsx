"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useRouter } from "@/i18n/navigation";
import { OrganizationForm } from "./OrganizationForm";

type Props = {
  organization: {
    id: number;
    name: string;
    address: string | null;
    country: string | null;
    licenceNumber: string | null;
    licenceClass: string | null;
    comment: string | null;
  };
};

/** "Edit" button for the organization page; the form opens in a dialog. Administrators only. */
export function OrganizationEditButton({ organization }: Props) {
  const t = useTranslations("organizations.form");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={<Pencil />} onClick={() => setOpen(true)}>
        {t("editButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("editTitle", { name: organization.name })}
        description={t("editDescription")}
      >
        <OrganizationForm
          mode="edit"
          organizationId={organization.id}
          initial={{
            name: organization.name,
            address: organization.address ?? "",
            country: organization.country ?? "",
            licenceNumber: organization.licenceNumber ?? "",
            licenceClass: organization.licenceClass ?? "",
            comment: organization.comment ?? "",
          }}
          onSuccess={() => {
            setOpen(false);
            // The page re-reads the record; the audit entry appears in "Profile activity".
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
