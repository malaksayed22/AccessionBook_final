import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * An error message for a group of controls that has no single <Field> (the same look as a Field's
 * error: icon, spoken "Error", announced politely). The container is always in the DOM so a new
 * message is read out; point `aria-describedby` of the control that holds focus at `id`.
 */
export function InlineError({ id, children }: { id: string; children?: ReactNode }) {
  const t = useTranslations("ui");
  return (
    <div id={id} aria-live="polite">
      {children ? (
        <p className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="sr-only">{t("tone.danger")}: </span>
            {children}
          </span>
        </p>
      ) : null}
    </div>
  );
}
