"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

export function AcceptInviteForm({ token, username }: { token: string; username: string }) {
  const t = useTranslations("auth.invite");
  const router = useRouter();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && confirm === password;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const result = await sendJson<{ next: "done" | "enrol" | "offer-enrol" }>(
      "/api/auth/invite/accept",
      {
        token,
        password,
      }
    );
    if (!result.ok) {
      setError(result.network ? networkMessage : describe(result.error));
      setSubmitting(false);
      return;
    }
    // Administrators continue to two-step setup on the sign-in page.
    router.push(result.data.next === "enrol" ? "/login" : "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Lets password managers file the new credential under the right username. */}
      <input type="text" value={username} autoComplete="username" readOnly hidden />

      <Field label={t("newPassword")} hint={t("rules", { min: MIN_PASSWORD_LENGTH })} required>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
          />
        )}
      </Field>
      <Field label={t("confirmPassword")} error={mismatch ? t("mismatch") : undefined} required>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        )}
      </Field>
      <div aria-live="polite">{error ? <Banner tone="danger">{error}</Banner> : null}</div>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        loading={submitting}
        disabled={!canSubmit}
      >
        {submitting ? t("activating") : t("activate")}
      </Button>
    </form>
  );
}
