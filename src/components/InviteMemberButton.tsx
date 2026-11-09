"use client";

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { InviteLinkPanel } from "@/components/InviteLinkPanel";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/FormControls";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { isValidEmail, isValidUsername } from "@/lib/member-validation";
import { useRequestAction } from "./use-request-action";

const ROLE_CHOICES = ["REGULAR", "QA", "INVENTORY", "INSPECTOR", "ADMIN"] as const;
type Role = (typeof ROLE_CHOICES)[number];
type Issued = { name: string; email: string; invitePath: string; expiresAt: string };
type InviteResponse = {
  member: { name: string; email: string };
  invitePath: string;
  expiresAt: string;
};

/** Administrators invite a member: a name, an address and a role produce a one-time sign-up link. */
export function InviteMemberButton() {
  const t = useTranslations("members.invite");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next && issued) {
      setIssued(null);
      router.refresh();
    }
  }

  return (
    <>
      <Button variant="primary" icon={<UserPlus />} onClick={() => setOpen(true)}>
        {t("button")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={issued ? t("readyTitle") : t("title")}
        description={issued ? t("readyDescription") : t("description")}
        footer={
          issued ? (
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t("done")}
            </Button>
          ) : undefined
        }
      >
        {issued ? (
          <InviteLinkPanel {...issued} />
        ) : (
          <InviteForm onIssued={setIssued} onCancel={() => onOpenChange(false)} />
        )}
      </Dialog>
    </>
  );
}

function InviteForm({
  onIssued,
  onCancel,
}: {
  onIssued: (issued: Issued) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("members.invite");
  const domain = useTranslations("domain");
  const action = useRequestAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("REGULAR");
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const next = {
      name: isValidUsername(trimmedName) ? undefined : t("nameInvalid"),
      email: isValidEmail(trimmedEmail) ? undefined : t("emailInvalid"),
    };
    setErrors(next);
    if (next.name || next.email) return;

    const result = await action.run(() =>
      sendJson<InviteResponse>("/api/members", { name: trimmedName, email: trimmedEmail, role })
    );
    if (!result.ok) return;
    onIssued({
      name: result.data.member.name,
      email: result.data.member.email,
      invitePath: result.data.invitePath,
      expiresAt: result.data.expiresAt,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {action.error ? <Banner tone="danger">{action.error}</Banner> : null}

      <Field label={t("name")} hint={t("nameHint")} error={errors.name} required>
        {(control) => (
          <Input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            maxLength={40}
            {...control}
          />
        )}
      </Field>

      <Field label={t("email")} error={errors.email} required>
        {(control) => (
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            maxLength={254}
            {...control}
          />
        )}
      </Field>

      <Field label={t("role")} hint={t(`roleHints.${role}`)}>
        {(control) => (
          <Select
            name="role"
            value={role}
            onChange={(event) =>
              setRole(
                (ROLE_CHOICES as readonly string[]).includes(event.target.value)
                  ? (event.target.value as Role)
                  : "REGULAR"
              )
            }
            {...control}
          >
            {ROLE_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {domain(`role.${choice}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={action.pending}>
          {t("cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={action.pending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
