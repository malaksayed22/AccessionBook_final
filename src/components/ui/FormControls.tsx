import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useFieldIds } from "./Field";
import { controlBase, focusRing, lineControl } from "./styles";

/*
 * Native, token-styled form controls. Put them inside <Field> and spread the `control` it hands
 * you (id, aria-describedby, aria-invalid, aria-required):
 *
 *   <Field label="Notes">{(control) => <Textarea rows={4} {...control} />}</Field>
 *
 * Input borders use `border-input` (3:1 against every surface). Invalid state is styled from
 * `aria-invalid`, so it is only ever shown when it is also announced.
 */
/** `box` is the form field; `line` is the borderless hairline used in list toolbars. */
export type ControlVariant = "box" | "line";

export type InputProps = ComponentProps<"input"> & { variant?: ControlVariant };

export function Input({ className, type = "text", variant = "box", ...rest }: InputProps) {
  return (
    <input
      type={type}
      className={cn(variant === "line" ? lineControl : controlBase, className)}
      {...rest}
    />
  );
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea rows={rows} className={cn(controlBase, "min-h-24 resize-y", className)} {...rest} />
  );
}

export type SelectProps = ComponentProps<"select"> & {
  /** Class for the wrapper that positions the chevron. */
  wrapperClassName?: string;
  variant?: ControlVariant;
};

export function Select({
  className,
  wrapperClassName,
  variant = "box",
  children,
  ...rest
}: SelectProps) {
  const line = variant === "line";
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select
        className={cn(
          line ? lineControl : controlBase,
          "appearance-none",
          // The open list is drawn by the browser: give its options the theme's colours, so a
          // transparent (line) select does not open a white list with light text in dark mode.
          "[&_option]:bg-surface [&_option]:text-fg",
          line ? "pe-6" : "pe-10",
          className
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-fg-secondary",
          line ? "end-0" : "end-3"
        )}
      />
    </div>
  );
}

export type CheckboxProps = Omit<ComponentProps<"input">, "type" | "children"> & {
  label: ReactNode;
  /** Secondary line under the label, announced as the description. */
  description?: ReactNode;
};

export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id);
  return (
    <label
      htmlFor={ids.id}
      className={cn(
        "flex min-h-10 cursor-pointer items-start gap-3 py-1.5 text-sm text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        className
      )}
    >
      <span className="relative mt-0.5 inline-flex size-5 shrink-0">
        <input
          id={ids.id}
          type="checkbox"
          aria-describedby={description ? ids.hintId : rest["aria-describedby"]}
          className={cn(
            "peer size-5 cursor-[inherit] appearance-none rounded-[0.4rem] border border-border-input bg-surface p-0 shadow-xs transition-colors duration-150",
            "checked:border-accent checked:bg-accent aria-invalid:border-danger",
            focusRing
          )}
          {...rest}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3.5 text-on-accent opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {description ? (
          <span id={ids.hintId} className="mt-0.5 block text-fg-secondary">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
