"use client";

import {
  Download,
  EllipsisVertical,
  KeyRound,
  Link2,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserX,
  Eraser,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { InviteLinkPanel } from "@/components/InviteLinkPanel";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Select, Textarea } from "@/components/ui/FormControls";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/DropdownMenu";
import { IconButton } from "@/components/ui/IconButton";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson, type ApiResult } from "@/lib/client-api";
import { ROLES, type Role } from "@/lib/roles";
import { useRequestAction } from "./use-request-action";

export type MemberActionTarget = {
  id: number;
  /** The real name as stored: the phrase typed to confirm an erasure. */
  name: string;
  /** What the page shows for this member (a translated pseudonym when the data was erased). */
  displayName: string;
  email: string | null;
  status: "active" | "invited" | "deactivated";
  /** Personal data was already erased. */
  erased: boolean;
  role: Role;
};

type Kind = "reissue" | "revoke" | "deactivate" | "reactivate" | "reset-mfa" | "pseudonymise";
type Issued = { invitePath: string; expiresAt: string };

const TONE: Record<Kind, "danger" | "primary"> = {
  reissue: "primary",
  revoke: "danger",
  deactivate: "danger",
  reactivate: "primary",
  "reset-mfa": "danger",
  pseudonymise: "danger",
};
const NEEDS_REASON: Kind[] = ["deactivate", "reset-mfa", "pseudonymise"];

function send(id: number, kind: Kind, reason: string): Promise<ApiResult<Issued>> {
  const url = `/api/members/${id}`;
  if (kind === "revoke") return sendJson<Issued>(url, undefined, "DELETE");
  return sendJson<Issued>(
    url,
    NEEDS_REASON.includes(kind) ? { action: kind, reason } : { action: kind },
    "PATCH"
  );
}

type Props = {
  member: MemberActionTarget;
  isSelf: boolean;
  /** `icon` for table rows, `button` for the member page. */
  variant?: "icon" | "button";
  /** Where to go once the member no longer exists (a revoked invitation). Refreshes in place if absent. */
  afterRemoveHref?: string;
};

/**
 * Everything an administrator can do to one member, in a menu. Each action asks for confirmation (with a
 * reason where it ends access or erases data); the password re-confirmation opens by itself when the
 * server asks for it. The menu is built from the member's status, and the server enforces every rule again.
 */
export function MemberRowActions({ member, isSelf, variant = "icon", afterRemoveHref }: Props) {
  const t = useTranslations("members.actions");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [confirm, setConfirm] = useState<Kind | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [changingRole, setChangingRole] = useState(false);

  function ask(kind: Kind) {
    action.reset();
    setConfirm(kind);
  }

  async function run(kind: Kind, reason: string) {
    const result = await action.run(() => send(member.id, kind, reason));
    if (!result.ok) return;
    setConfirm(null);
    toast({ tone: "success", title: t(`${kind}.done`, { name: member.displayName }) });
    if (kind === "reissue") setIssued(result.data);
    else if (kind === "revoke" && afterRemoveHref) router.push(afterRemoveHref);
    else router.refresh();
  }

  const items: ReactNode[] = [];
  if (member.status === "invited") {
    items.push(
      <MenuItem key="reissue" icon={<Link2 />} onSelect={() => ask("reissue")}>
        {t("reissue.menu")}
      </MenuItem>,
      <MenuItem key="revoke" icon={<UserX />} tone="danger" onSelect={() => ask("revoke")}>
        {t("revoke.menu")}
      </MenuItem>
    );
  }
  if (member.status !== "deactivated" && !isSelf) {
    items.push(
      <MenuItem
        key="role"
        icon={<ShieldCheck />}
        onSelect={() => {
          action.reset();
          setChangingRole(true);
        }}
      >
        {t("role.menu")}
      </MenuItem>
    );
  }
  if (member.status === "active" && !isSelf) {
    items.push(
      <MenuItem key="reset-mfa" icon={<ShieldOff />} onSelect={() => ask("reset-mfa")}>
        {t("reset-mfa.menu")}
      </MenuItem>,
      <MenuItem
        key="deactivate"
        icon={<UserMinus />}
        tone="danger"
        onSelect={() => ask("deactivate")}
      >
        {t("deactivate.menu")}
      </MenuItem>
    );
  }
  if (member.status === "deactivated" && !member.erased) {
    items.push(
      <MenuItem key="reactivate" icon={<UserCheck />} onSelect={() => ask("reactivate")}>
        {t("reactivate.menu")}
      </MenuItem>,
      <MenuItem
        key="pseudonymise"
        icon={<Eraser />}
        tone="danger"
        onSelect={() => ask("pseudonymise")}
      >
        {t("pseudonymise.menu")}
      </MenuItem>
    );
  }
  // A plain link: the browser downloads the file, so the export is not blocked by the page.
  const exportItem = member.status !== "invited" && (
    <MenuItem key="export" asChild>
      <a href={`/api/members/${member.id}/export`} download>
        <Download aria-hidden="true" className="size-4" />
        {t("export.menu")}
      </a>
    </MenuItem>
  );

  if (items.length === 0 && !exportItem) return null;

  const copy = confirm
    ? {
        title: t(`${confirm}.title`, { name: member.displayName }),
        description: t(`${confirm}.body`, { name: member.displayName }),
        label: t(`${confirm}.confirm`),
      }
    : null;

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          {variant === "button" ? (
            <Button variant="secondary" icon={<KeyRound />}>
              {t("button")}
            </Button>
          ) : (
            <IconButton label={t("menu", { name: member.displayName })} size="sm">
              <EllipsisVertical />
            </IconButton>
          )}
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>{member.displayName}</MenuLabel>
          {items}
          {items.length > 0 && exportItem ? <MenuSeparator /> : null}
          {exportItem}
        </MenuContent>
      </Menu>

      {confirm && copy ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirm(null)}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.label}
          tone={TONE[confirm]}
          requireReason={NEEDS_REASON.includes(confirm)}
          reasonHint={t("reasonHint")}
          typeToConfirm={confirm === "pseudonymise" ? member.name : undefined}
          typeToConfirmLabel={
            confirm === "pseudonymise"
              ? t("pseudonymise.typeLabel", { name: member.name })
              : undefined
          }
          pending={action.pending}
          error={action.error}
          onConfirm={({ reason }) => {
            void run(confirm, reason);
          }}
        />
      ) : null}

      {changingRole ? (
        <ChangeRoleDialog
          member={member}
          pending={action.pending}
          error={action.error}
          onClose={() => setChangingRole(false)}
          onConfirm={async (role, reason) => {
            const result = await action.run(() =>
              sendJson(`/api/members/${member.id}`, { action: "role", role, reason }, "PATCH")
            );
            if (!result.ok) return;
            setChangingRole(false);
            toast({ tone: "success", title: t("role.done", { name: member.displayName }) });
            router.refresh();
          }}
        />
      ) : null}

      <Dialog
        open={issued !== null}
        onOpenChange={(next) => {
          if (next) return;
          setIssued(null);
          router.refresh();
        }}
        title={t("reissue.linkTitle")}
        description={t("reissue.linkDescription")}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setIssued(null);
              router.refresh();
            }}
          >
            {t("done")}
          </Button>
        }
      >
        {issued ? (
          <InviteLinkPanel
            name={member.displayName}
            email={member.email}
            invitePath={issued.invitePath}
            expiresAt={issued.expiresAt}
          />
        ) : null}
      </Dialog>
    </>
  );
}

const ROLE_REASON_MIN = 10;

/** Choose another role, with a reason for the audit trail. The password is confirmed if asked. */
function ChangeRoleDialog({
  member,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  member: MemberActionTarget;
  pending: boolean;
  error: ReactNode;
  onClose: () => void;
  onConfirm: (role: Role, reason: string) => void | Promise<void>;
}) {
  const t = useTranslations("members.actions");
  const invite = useTranslations("members.invite");
  const domain = useTranslations("domain");
  const common = useTranslations("common");
  const [role, setRole] = useState<Role>(member.role);
  const [reason, setReason] = useState("");
  const ready = role !== member.role && reason.trim().length >= ROLE_REASON_MIN;

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("role.title", { name: member.displayName })}
      description={t("role.body")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {common("actions.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!ready || pending}
            onClick={() => void onConfirm(role, reason.trim())}
          >
            {t("role.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("role.label")} hint={invite(`roleHints.${role}`)} required>
          {(control) => (
            <Select
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              {...control}
            >
              {ROLES.map((choice) => (
                <option key={choice} value={choice}>
                  {domain(`role.${choice}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("role.reason")} hint={t("reasonHint")} required>
          {(control) => (
            <Textarea
              rows={3}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              {...control}
            />
          )}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
