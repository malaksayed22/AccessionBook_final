"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { EntityLink } from "@/components/page/EntityLink";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/FormControls";
import { IconButton } from "@/components/ui/IconButton";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

type Member = { userId: number; name: string; role: "LEAD" | "MEMBER" };

/*
 * The experiment's team. Everyone sees it; only administrators assign and remove members (the API is
 * admin-only too). The lead cannot be removed. Data comes from the server page and is refreshed after
 * each change, so the list never drifts from the record.
 */
export function ExperimentMembersPanel({
  experimentId,
  members,
  availableUsers,
  canManage,
}: {
  experimentId: number;
  members: Member[];
  availableUsers: Array<{ id: number; name: string }>;
  canManage: boolean;
}) {
  const t = useTranslations("experiments.members");
  const role = useTranslations("domain.experimentRole");
  const router = useRouter();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const { toast } = useToast();

  const [selected, setSelected] = useState("");
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const fail = (result: { network: boolean; error: Parameters<typeof apiError>[0] }) =>
    result.network ? networkError : apiError(result.error);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setAdding(true);
    setFailure(null);
    const result = await sendJson<{ name: string }>(`/api/experiments/${experimentId}/members`, {
      userId: Number(selected),
    });
    setAdding(false);
    if (!result.ok) {
      setFailure(fail(result));
      return;
    }
    toast({ tone: "success", title: t("added", { name: result.data.name }) });
    setSelected("");
    router.refresh();
  }

  async function remove(member: Member) {
    setRemoveError(null);
    const result = await sendJson(
      `/api/experiments/${experimentId}/members?userId=${member.userId}`,
      undefined,
      "DELETE"
    );
    if (!result.ok) {
      setRemoveError(fail(result));
      throw new Error("remove failed");
    }
    toast({ tone: "success", title: t("removed", { name: member.name }) });
    router.refresh();
  }

  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={t("description", { count: members.length })}
        headingLevel={2}
      />
      <PanelBody className="space-y-4">
        {members.length > 0 ? (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li key={member.userId} className="flex min-h-15 items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <EntityLink kind="member" id={member.userId} className="wrap-break-word">
                    {member.name}
                  </EntityLink>
                  <Badge tone={member.role === "LEAD" ? "accent" : "neutral"}>
                    {role(member.role)}
                  </Badge>
                </span>
                {canManage && member.role !== "LEAD" ? (
                  <IconButton
                    label={t("remove", { name: member.name })}
                    variant="ghost"
                    onClick={() => {
                      setRemoveError(null);
                      setRemoving(member);
                    }}
                  >
                    <UserMinus />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-secondary">{t("none")}</p>
        )}

        {canManage ? (
          <form onSubmit={add} className="space-y-4 border-t border-border pt-4">
            {failure ? <Banner tone="danger">{failure}</Banner> : null}
            <Field
              label={t("addLabel")}
              hint={availableUsers.length === 0 ? t("everyoneAssigned") : undefined}
            >
              {(control) => (
                <Select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={adding || availableUsers.length === 0}
                  {...control}
                >
                  <option value="">{t("choose")}</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              type="submit"
              variant="secondary"
              icon={<UserPlus />}
              loading={adding}
              disabled={!selected}
            >
              {t("add")}
            </Button>
          </form>
        ) : (
          <p className="border-t border-border pt-4 text-sm text-fg-secondary">{t("adminOnly")}</p>
        )}
      </PanelBody>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        tone="primary"
        title={t("confirmTitle", { name: removing?.name ?? "" })}
        description={t("confirmBody")}
        confirmLabel={t("confirmRemove")}
        error={removeError}
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </Panel>
  );
}
