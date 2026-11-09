"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";

type Setup = { secret: string; qrDataUrl: string };

/**
 * Two-step verification setup: scan the QR code, confirm with one code, then keep the recovery
 * codes. Used both at forced enrolment (administrators) and from the profile page.
 */
export function MfaEnrol({ onDone }: { onDone: () => void }) {
  const t = useTranslations("auth.enrol");
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError("");
    const result = await sendJson<Setup>("/api/auth/mfa/setup", {});
    setBusy(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    setSetup(result.data);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await sendJson<{ recoveryCodes: string[] }>("/api/auth/mfa/enable", { code });
    setBusy(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    setCodes(result.data.recoveryCodes);
  }

  const errorBanner = (
    <div aria-live="polite">{error ? <Banner tone="danger">{error}</Banner> : null}</div>
  );

  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-fg">{t("recoveryTitle")}</h2>
        <p className="text-sm text-fg-secondary">{t("recoveryBody")}</p>
        <ul className="grid grid-cols-1 gap-2 rounded-lg bg-sunken p-3 font-mono text-sm text-fg sm:grid-cols-2">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button variant="primary" size="lg" className="w-full" onClick={onDone}>
          {t("saved")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
        <ShieldCheck className="size-5 text-accent-text" aria-hidden /> {t("title")}
      </h2>
      {!setup ? (
        <>
          <p className="text-sm text-fg-secondary">{t("intro")}</p>
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={start}>
            {t("begin")}
          </Button>
        </>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <p className="text-sm text-fg-secondary">{t("scan")}</p>
          {/* A data: URL generated on the server; there is nothing for next/image to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qrDataUrl}
            alt={t("qrAlt")}
            width={220}
            height={220}
            className="max-w-full self-start rounded-lg bg-white p-1"
          />
          <p className="text-sm text-fg-secondary">
            {t("manualKey")}{" "}
            <span className="font-mono break-all text-fg select-all">{setup.secret}</span>
          </p>
          <Field label={t("code")} required>
            {(control) => (
              <Input
                {...control}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
              />
            )}
          </Field>
          {errorBanner}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            loading={busy}
            disabled={code.replace(/\s/g, "").length !== 6}
          >
            {t("turnOn")}
          </Button>
        </form>
      )}
      {!setup && errorBanner}
    </div>
  );
}
