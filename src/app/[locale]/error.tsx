"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

/**
 * Last-resort error boundary for a page. The message is deliberately generic; the digest lets
 * support find the exact server log line without showing internals to the user.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors.page");
  return (
    <main
      id="main"
      className="relative isolate mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center gap-5 px-6 py-20"
    >
      <div
        aria-hidden="true"
        className="dot-grid pointer-events-none absolute inset-0 -z-10 opacity-60 mask-[radial-gradient(ellipse_at_30%_40%,black,transparent_70%)]"
      />
      <h1 className="text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-fg sm:text-6xl">
        {t("errorTitle")}
      </h1>
      <p className="max-w-lg text-lg text-fg-secondary">{t("errorBody")}</p>
      {error.digest && (
        <p className="font-mono text-xs text-fg-tertiary">
          {t("errorReference", { digest: error.digest })}
        </p>
      )}
      <div className="flex flex-wrap gap-3 pt-3">
        <Button variant="primary" size="lg" onClick={reset}>
          {t("retry")}
        </Button>
        <Button href="/dashboard" variant="secondary" size="lg">
          {t("goHome")}
        </Button>
      </div>
    </main>
  );
}
