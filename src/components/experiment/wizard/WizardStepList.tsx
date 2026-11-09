"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { WIZARD_STEPS, type WizardStep } from "./wizard-state";

/*
 * The wizard's step list: an ordered list of buttons, the current one marked aria-current="step".
 * A step can be opened once it has been reached (going back is always free; going forward goes
 * through "Next", which checks the step). State is spoken, not only coloured: done / current / to do.
 */
export function WizardStepList({
  current,
  reached,
  onSelect,
}: {
  current: WizardStep;
  /** Index of the furthest step opened so far. */
  reached: number;
  onSelect: (step: WizardStep) => void;
}) {
  const t = useTranslations("experiments.wizard");
  const currentIndex = WIZARD_STEPS.indexOf(current);

  return (
    <nav aria-label={t("stepList.label")}>
      <ol className="grid gap-2 sm:grid-cols-4">
        {WIZARD_STEPS.map((step, index) => {
          const done = index < currentIndex;
          const isCurrent = step === current;
          const available = index <= reached;
          return (
            <li key={step}>
              <button
                type="button"
                disabled={!available}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onSelect(step)}
                className={cn(
                  "flex h-full w-full items-center gap-3 rounded-lg border px-3 py-2 text-start text-sm",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  "disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11",
                  isCurrent
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-border-input bg-surface text-fg hover:bg-hover disabled:hover:bg-surface"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                    isCurrent ? "border-accent bg-accent text-on-accent" : "border-border-input"
                  )}
                >
                  {done ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium wrap-break-word">{t(`steps.${step}`)}</span>
                  <span className="sr-only">
                    {isCurrent
                      ? t("stepList.current")
                      : done
                        ? t("stepList.done")
                        : t("stepList.todo")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
