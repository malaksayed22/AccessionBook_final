"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson, setReauthHandler } from "@/lib/client-api";

/**
 * Sensitive actions (destroy, release a hold, deactivate a member, reset MFA) need a password
 * confirmation within a few minutes. When the server asks, every `sendJson` call lands here: the
 * user confirms in a dialog, then the original request is sent again. Mount once in the shell.
 */
export function ReauthProvider() {
  const t = useTranslations("auth.reauth");
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    pending.current?.(confirmed);
    pending.current = null;
    setOpen(false);
    setPassword("");
    setError("");
  }, []);

  useEffect(() => {
    setReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          pending.current = resolve;
          setOpen(true);
        })
    );
    return () => setReauthHandler(null);
  }, []);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await sendJson("/api/auth/reauth", { password });
    setBusy(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    settle(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
      title={t("title")}
      description={t("body")}
      size="sm"
    >
      <form onSubmit={confirm} className="flex flex-col gap-4">
        <Field label={t("password")} required>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div aria-live="polite">{error ? <Banner tone="danger">{error}</Banner> : null}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => settle(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!password}>
            {t("confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
