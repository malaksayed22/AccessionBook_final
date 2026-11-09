import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * A choice between a few options, shown as buttons but built on native radio inputs: arrow keys move
 * between options, the group has a legend, and the chosen option shows a check mark as well as a
 * colour. Used for "one cultivar / mixed", "all the same / different statuses", "internal / external".
 */
export function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  hint,
  className,
}: {
  legend: ReactNode;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-1.5 text-sm font-medium text-fg">{legend}</legend>
      {hint ? <p className="mb-2 text-sm text-fg-secondary">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="min-w-40 flex-1">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-input bg-surface px-3 py-2 text-center text-sm text-fg",
                "hover:bg-hover peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-medium peer-checked:text-accent-text",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus pointer-coarse:min-h-11",
                "[&>svg]:hidden peer-checked:[&>svg]:block"
              )}
            >
              <Check aria-hidden="true" className="size-4 shrink-0" />
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
