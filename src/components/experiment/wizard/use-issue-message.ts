"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { FieldIssue } from "./wizard-validation";

/** Turns an issue code into a sentence; codes come from the validation module, not from the user. */
export function useIssueMessage() {
  const t = useTranslations("experiments.wizard.errors");
  const message = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  return useCallback(
    (issue: FieldIssue | undefined): string | undefined =>
      issue ? message(issue.code, issue.values) : undefined,
    [message]
  );
}
