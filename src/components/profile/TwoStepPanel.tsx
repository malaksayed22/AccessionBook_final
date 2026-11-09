"use client";

import { CircleCheck, CircleDashed } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MfaEnrol } from "@/components/MfaEnrol";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

type Mode = "idle" | "enrolling" | "codes" | "disabling";

/** Two-step verification: status, set-up, new recovery codes and (where allowed) turning it off. */
export function TwoStepPanel({
  enabled,
  required,
  recoveryCodesLeft,
}: {
  enabled: boolean;
  /** True for roles where two-step cannot be turned off. */
  required: boolean;
  recoveryCodesLeft: number;
}) {
  const t = useTranslations("profile.twoStep");
  const router = useRouter();
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [mode, setMode] = useState<Mode>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode("idle");
    setPassword("");
    setCode("");
    setError("");
  };

  async function regenerate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await sendJson<{ recoveryCodes: string[] }>("/api/auth/mfa/recovery-codes", {
      code,
    });
    setBusy(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    setNewCodes(result.data.recoveryCodes);
    reset();
    router.refresh();
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await sendJson("/api/auth/mfa/disable", { password, code });
    setBusy(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    reset();
    router.refresh();
  }

  const errorBanner = (
    <div aria-live="polite">{error ? <Banner tone="danger">{error}</Banner> : null}</div>
  );

  return (
    <Panel className="overflow-hidden before:hidden lg:grid lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <PanelHeader
        title={t("title")}
        description={t("description")}
        className="bg-none lg:grid lg:content-start lg:gap-2 lg:rounded-none lg:border-b-0 lg:border-e lg:bg-sunken/50 lg:px-8 lg:py-7"
        actions={
          <Badge
            tone={enabled ? "success" : "warning"}
            icon={enabled ? <CircleCheck /> : <CircleDashed />}
          >
            {enabled ? t("on") : t("off")}
          </Badge>
        }
      />
      <PanelBody className="flex flex-col gap-6 lg:p-8">
        {mode === "enrolling" ? (
          <MfaEnrol
            onDone={() => {
              reset();
              router.refresh();
            }}
          />
        ) : !enabled ? (
          <Button variant="primary" className="self-start" onClick={() => setMode("enrolling")}>
            {t("setUp")}
          </Button>
        ) : (
          <>
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium text-fg">
                {t("recoveryLeft", { count: recoveryCodesLeft })}
              </p>
              <p className="text-fg-secondary">{t("recoveryHelp")}</p>
            </div>

            {newCodes ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-fg">{t("newCodesDone")}</p>
                <ul className="grid grid-cols-1 gap-2 rounded-lg bg-sunken p-3 font-mono text-sm text-fg sm:grid-cols-2">
                  {newCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {mode === "codes" ? (
              <form onSubmit={regenerate} className="flex max-w-md flex-col gap-4">
                <Field label={t("code")} hint={t("newCodesHelp")} required>
                  {(control) => (
                    <Input
                      {...control}
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  )}
                </Field>
                {errorBanner}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" variant="primary" loading={busy} disabled={!code.trim()}>
                    {t("newCodesSubmit")}
                  </Button>
                  <Button variant="secondary" onClick={reset}>
                    {t("cancel")}
                  </Button>
                </div>
              </form>
            ) : mode === "disabling" ? (
              <form onSubmit={disable} className="flex max-w-md flex-col gap-4">
                <p className="text-sm text-fg-secondary">{t("turnOffHelp")}</p>
                <Field label={t("currentPassword")} required>
                  {(control) => (
                    <Input
                      {...control}
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={t("code")} required>
                  {(control) => (
                    <Input
                      {...control}
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  )}
                </Field>
                {errorBanner}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    variant="danger"
                    loading={busy}
                    disabled={!password || !code.trim()}
                  >
                    {t("turnOff")}
                  </Button>
                  <Button variant="secondary" onClick={reset}>
                    {t("cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => setMode("codes")}>
                  {t("newCodes")}
                </Button>
                {required ? (
                  <p className="text-sm text-fg-secondary">{t("requiredForRole")}</p>
                ) : (
                  <Button variant="secondary" onClick={() => setMode("disabling")}>
                    {t("turnOffStart")}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
