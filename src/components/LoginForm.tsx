"use client";

import { LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { MfaEnrol } from "@/components/MfaEnrol";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { useRouter } from "@/i18n/navigation";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { sendJson } from "@/lib/client-api";
import { safeRedirectPath } from "@/lib/safe-redirect";

/** Frameless transparent pill: accent text at rest, solid accent on hover. */
const SUBMIT_BUTTON_CLASS =
  "w-full rounded-full border-accent-text bg-transparent font-semibold text-accent-text enabled:hover:border-accent enabled:hover:bg-accent enabled:hover:text-on-accent";

type Step = "credentials" | "code" | "enrol" | "offer-enrol";

/**
 * Sign-in in up to three steps: password, then (if the account has two-step verification) the
 * code, or (for administrators who have none yet) setup. A half-finished sign-in resumes at the
 * right step because the server renders `initialStep` from the pending session.
 */
export function LoginForm({ initialStep = "credentials" }: { initialStep?: Step }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const nextPath = safeRedirectPath(useSearchParams().get("next"));
  const describe = useApiError();
  const networkMessage = useNetworkError();

  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function finish() {
    router.push(nextPath);
    router.refresh();
  }

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !password) return;
    setLoading(true);
    setError("");
    const result = await sendJson<{ next: "done" | "mfa" | "enrol" | "offer-enrol" }>(
      "/api/auth/login",
      {
        name: name.trim(),
        password,
      }
    );
    setLoading(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    if (result.data.next === "done") return finish();
    setPassword("");
    setStep(result.data.next === "mfa" ? "code" : result.data.next);
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const result = await sendJson("/api/auth/mfa/verify", { code });
    setLoading(false);
    if (!result.ok) return setError(result.network ? networkMessage : describe(result.error));
    finish();
  }

  const errorBanner = (
    <div aria-live="polite">{error ? <Banner tone="danger">{error}</Banner> : null}</div>
  );

  if (step === "offer-enrol") {
    // Optional: the session is already signed in, so skipping simply goes on to the app.
    return (
      <div className="flex flex-col gap-4">
        <Banner tone="info">{t("enrol.optional")}</Banner>
        <MfaEnrol onDone={finish} />
        <Button variant="ghost" size="lg" className="w-full" onClick={finish}>
          {t("enrol.skip")}
        </Button>
      </div>
    );
  }

  if (step === "enrol") {
    return (
      <div className="flex flex-col gap-4">
        <Banner tone="info">{t("enrol.requiredForRole")}</Banner>
        <MfaEnrol onDone={finish} />
      </div>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-fg">{t("mfa.title")}</h2>
        <Field label={t("mfa.code")} hint={t("mfa.help")} required>
          {(control) => (
            <Input
              {...control}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="text"
              placeholder={t("mfa.placeholder")}
              autoFocus
            />
          )}
        </Field>
        {errorBanner}
        <Button
          type="submit"
          variant="secondary"
          size="lg"
          className={SUBMIT_BUTTON_CLASS}
          loading={loading}
          disabled={!code.trim()}
        >
          {loading ? t("mfa.verifying") : t("mfa.verify")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} className="flex flex-col gap-4">
      <Field label={t("login.username")} required>
        {(control) => (
          <Input
            {...control}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        )}
      </Field>
      <Field label={t("login.password")} required>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        )}
      </Field>
      {errorBanner}
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        className={SUBMIT_BUTTON_CLASS}
        loading={loading}
        disabled={!name.trim() || !password}
        icon={<LogIn />}
      >
        {loading ? t("login.signingIn") : t("login.signIn")}
      </Button>
    </form>
  );
}
