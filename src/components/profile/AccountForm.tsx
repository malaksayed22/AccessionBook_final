"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

/** Username and experiment code prefix. Confirming with the current password is required by the server. */
export function AccountForm({
  currentName,
  currentInitials,
}: {
  currentName: string;
  currentInitials: string;
}) {
  const t = useTranslations("profile.general");
  const router = useRouter();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [name, setName] = useState(currentName);
  const [initials, setInitials] = useState(currentInitials);
  const [currentPassword, setCurrentPassword] = useState("");
  const [needCurrent, setNeedCurrent] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setNeedCurrent(!currentPassword);
    if (!currentPassword) return;

    const nextInitials = initials
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase()
      .slice(0, 4);
    setLoading(true);
    const result = await sendJson<{ unchanged?: boolean }>(
      "/api/auth/profile",
      {
        currentPassword,
        name: name.trim() !== currentName ? name.trim() : undefined,
        initials: nextInitials !== currentInitials ? nextInitials : undefined,
      },
      "PATCH"
    );
    setLoading(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    setSuccess(result.data.unchanged ? t("unchanged") : t("saved"));
    setCurrentPassword("");
    router.refresh();
  }

  return (
    <Panel className="overflow-hidden before:hidden lg:grid lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <PanelHeader
        title={t("title")}
        description={t("description")}
        className="bg-none lg:grid lg:content-start lg:gap-2 lg:rounded-none lg:border-b-0 lg:border-e lg:bg-sunken/50 lg:px-8 lg:py-7"
      />
      <PanelBody className="lg:p-8">
        <form onSubmit={submit} className="flex max-w-md flex-col gap-5">
          <Field label={t("username")} hint={t("usernameHelp")} required>
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="username"
              />
            )}
          </Field>
          <Field label={t("prefix")} hint={t("prefixHelp", { example: initials || "XX" })}>
            {(control) => (
              <Input
                {...control}
                className="font-mono uppercase"
                value={initials}
                onChange={(e) =>
                  setInitials(
                    e.target.value
                      .replace(/[^A-Za-z]/g, "")
                      .toUpperCase()
                      .slice(0, 4)
                  )
                }
                maxLength={4}
                placeholder={t("prefixPlaceholder")}
              />
            )}
          </Field>
          <Field
            label={t("currentPassword")}
            hint={t("currentPasswordHelp")}
            error={needCurrent ? t("needCurrent") : undefined}
            required
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
          </Field>
          <div aria-live="polite" className="flex flex-col gap-2">
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {success ? <Banner tone="success">{success}</Banner> : null}
          </div>
          <Button type="submit" variant="primary" loading={loading} className="self-start">
            {loading ? t("saving") : t("save")}
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}
