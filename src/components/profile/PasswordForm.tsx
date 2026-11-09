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
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

/** Change the password. The server ends every other session when it succeeds. */
export function PasswordForm() {
  const t = useTranslations("profile.password");
  const router = useRouter();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [current, setCurrent] = useState("");
  const [errors, setErrors] = useState<{ next?: string; confirm?: string; current?: string }>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const found: typeof errors = {};
    if (!next) found.next = t("needNew");
    else if (next !== confirm) found.confirm = t("mismatch");
    if (!current) found.current = t("needCurrent");
    setErrors(found);
    if (found.next || found.confirm || found.current) return;

    setLoading(true);
    const result = await sendJson(
      "/api/auth/profile",
      { currentPassword: current, newPassword: next },
      "PATCH"
    );
    setLoading(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    setSuccess(t("saved"));
    setNext("");
    setConfirm("");
    setCurrent("");
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
          <Field
            label={t("new")}
            hint={t("rules", { min: MIN_PASSWORD_LENGTH })}
            error={errors.next}
            required
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("confirm")} error={errors.confirm} required>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("currentPassword")} error={errors.current} required>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
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
