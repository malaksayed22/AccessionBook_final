"use client";

import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import type { ActionOutcome } from "@/features/action/flow";
import type { ActionId } from "@/lib/action-catalog";

/** Message keys are chosen at run time from the action id, so the typed translator is widened here. */
export function doneMessage(
  t: ReturnType<typeof useTranslations<"actions">>,
  action: ActionId,
  outcome: ActionOutcome
): string {
  const message = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  return message(`done.${action}`, outcome.values);
}

/**
 * The last step. The result is also announced by a toast; this screen is the visible record of what
 * happened and takes focus so keyboard and screen-reader users land on it instead of on a button that
 * no longer exists.
 */
export function ActionDone({
  action,
  outcome,
  onAgain,
  onClose,
}: {
  action: ActionId;
  outcome: ActionOutcome;
  onAgain: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("actions");
  const message = doneMessage(t, action, outcome);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <CircleCheck aria-hidden="true" className="size-10 text-success" />
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-semibold wrap-break-word outline-none"
      >
        {message}
      </h3>
      <div className="flex flex-wrap justify-center gap-2">
        {outcome.href ? (
          <Button href={outcome.href} variant="primary" onClick={onClose}>
            {t("done.view")}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onAgain}>
          {t("done.another")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("done.close")}
        </Button>
      </div>
    </div>
  );
}
