import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";

export default async function NotFound() {
  const t = await getTranslations("errors.page");
  return (
    <main
      id="main"
      className="relative isolate mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center gap-5 px-6 py-20"
    >
      <div
        aria-hidden="true"
        className="dot-grid pointer-events-none absolute inset-0 -z-10 opacity-60 mask-[radial-gradient(ellipse_at_30%_40%,black,transparent_70%)]"
      />
      <p className="font-mono text-xs tracking-[0.14em] text-accent-text uppercase">404</p>
      <h1 className="text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-fg sm:text-6xl">
        {t("notFoundTitle")}
      </h1>
      <p className="max-w-lg text-lg text-fg-secondary">{t("notFoundBody")}</p>
      <div className="pt-3">
        <Button href="/dashboard" variant="primary" size="lg">
          {t("goHome")}
        </Button>
      </div>
    </main>
  );
}
