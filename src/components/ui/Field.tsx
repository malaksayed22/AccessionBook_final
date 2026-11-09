import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Usage (render prop, so it works in server and client components alike):
 *
 *   <Field label="Strain name" hint="As printed on the label" error={errors.name} required>
 *     {(control) => <Input name="name" {...control} />}
 *   </Field>
 *
 * Field wires the label (`htmlFor`), the hint and error (`aria-describedby`), `aria-invalid` and
 * `aria-required` onto whatever control receives `control`. The error sits in an `aria-live="polite"`
 * region that is always in the DOM, so a new message is announced without `role="alert"` (which
 * would interrupt the user mid-typing). Errors carry an icon and the word "Error" for screen
 * readers: they never rely on colour alone.
 */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};

export type FieldIds = { id: string; hintId: string; errorId: string };

/** Stable ids for a field, derived from React's `useId` (or from your own `base`). */
export function useFieldIds(base?: string): FieldIds {
  const generated = useId();
  const id = base ?? generated;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

/** The accessibility attributes a control needs, given what the field currently shows. */
export function fieldControlProps(
  ids: FieldIds,
  state: { hasHint: boolean; hasError: boolean; required?: boolean }
): FieldControlProps {
  const describedBy = [state.hasHint ? ids.hintId : null, state.hasError ? ids.errorId : null]
    .filter(Boolean)
    .join(" ");
  return {
    id: ids.id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": state.hasError ? true : undefined,
    "aria-required": state.required ? true : undefined,
  };
}

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** Error message; falsy means the field is valid. */
  error?: ReactNode;
  required?: boolean;
  /** Override the generated control id (useful when the server must know it). */
  id?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

export function Field({ label, hint, error, required, id, className, children }: FieldProps) {
  const t = useTranslations("ui");
  const ids = useFieldIds(id);
  const hasHint = Boolean(hint);
  const hasError = Boolean(error);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <label htmlFor={ids.id} className="text-sm font-medium tracking-[-0.005em] text-fg">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ms-1 text-fg-tertiary">
              *
            </span>
            <span className="sr-only"> ({t("required")})</span>
          </>
        ) : null}
      </label>
      {hasHint ? (
        <p id={ids.hintId} className="order-1 -mt-1 text-[0.8125rem] leading-5 text-fg-secondary">
          {hint}
        </p>
      ) : null}
      {children(fieldControlProps(ids, { hasHint, hasError, required }))}
      <div id={ids.errorId} aria-live="polite">
        {hasError ? (
          <p className="flex items-start gap-1.5 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="sr-only">{t("tone.danger")}: </span>
              {error}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
