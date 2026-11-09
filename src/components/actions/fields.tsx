"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/FormControls";
import type { FieldIssue } from "@/features/action/forms";

/** Turns a validation issue from `features/action/forms` into a sentence in the current language. */
export function useIssueText() {
  const t = useTranslations("actions.issues");
  return (issue: FieldIssue | undefined): string | undefined => {
    if (!issue) return undefined;
    switch (issue.code) {
      case "tooShort":
        return t("tooShort", { min: issue.min ?? 0 });
      case "range":
        if (issue.min !== undefined && issue.max !== undefined) {
          return t("rangeBetween", { min: issue.min, max: issue.max });
        }
        if (issue.min !== undefined) return t("rangeMin", { min: issue.min });
        return t("rangeMax", { max: issue.max ?? 0 });
      default:
        return t(issue.code);
    }
  };
}

type Common = {
  label: ReactNode;
  hint?: ReactNode;
  issue?: FieldIssue;
  required?: boolean;
  className?: string;
};

export function TextField({
  label,
  hint,
  issue,
  required,
  className,
  ...input
}: Common & Omit<ComponentProps<typeof Input>, "id">) {
  const issueText = useIssueText();
  return (
    <Field
      label={label}
      hint={hint}
      error={issueText(issue)}
      required={required}
      className={className}
    >
      {(control) => <Input {...control} {...input} />}
    </Field>
  );
}

export type Choice = { value: string; label: string };

export function SelectField({
  label,
  hint,
  issue,
  required,
  className,
  options,
  placeholder,
  ...select
}: Common &
  Omit<ComponentProps<typeof Select>, "id" | "children"> & {
    options: readonly Choice[];
    /** Label of the empty option; omit when a choice is always selected. */
    placeholder?: string;
  }) {
  const issueText = useIssueText();
  return (
    <Field
      label={label}
      hint={hint}
      error={issueText(issue)}
      required={required}
      className={className}
    >
      {(control) => (
        <Select {...control} {...select}>
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  issue,
  required,
  className,
  ...textarea
}: Common & Omit<ComponentProps<typeof Textarea>, "id">) {
  const issueText = useIssueText();
  return (
    <Field
      label={label}
      hint={hint}
      error={issueText(issue)}
      required={required}
      className={className}
    >
      {(control) => <Textarea rows={3} {...control} {...textarea} />}
    </Field>
  );
}
