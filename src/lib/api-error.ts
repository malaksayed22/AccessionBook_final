"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { ruleOrFieldMessage, type SchemaIssue } from "./api-error-text";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-rules";

/** The JSON body of a failed API call (see `withApi` in `server/http.ts`). */
export type ApiErrorBody = {
  ok?: false;
  code?: string;
  /** English fallback; the UI prefers its own translation of `code`. */
  error?: string;
  requestId?: string;
  /** Set when a bulk action was stopped by one unit: its name. */
  bulkUnit?: string;
  /** Schema failures: which field, and what is wrong with it. */
  issues?: SchemaIssue[];
  params?: {
    issue?: string;
    retryAfterSeconds?: number;
    units?: number;
    /** A business rule that refused the input (a key under `errors.reasons`). */
    reason?: string;
    values?: Record<string, string | number>;
  } | null;
};

/**
 * Turns a failed API response into a sentence in the user's language: the rule or the field that
 * refused the input when the server says which, otherwise the message for the code. Never raw
 * server text in another language.
 */
export function useApiError() {
  const t = useTranslations("errors");
  const locale = useLocale();
  // Keys are built from server-sent codes, so they cannot be checked at compile time.
  const message = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const exists = t.has as unknown as (key: string) => boolean;

  return useCallback(
    (body: ApiErrorBody | null | undefined): string => {
      const code = body?.code;
      if (!code) return t("unknown");

      if (code === "PASSWORD_POLICY") {
        const key = `passwordIssues.${body?.params?.issue}`;
        if (exists(key))
          return message(key, { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH });
      }
      if (code === "RATE_LIMITED") {
        const seconds = body?.params?.retryAfterSeconds ?? 60;
        return message("codes.RATE_LIMITED", { minutes: Math.max(1, Math.ceil(seconds / 60)) });
      }
      if (code === "LOCATION_NOT_EMPTY") {
        return message("codes.LOCATION_NOT_EMPTY", { units: body?.params?.units ?? 0 });
      }
      if (code === "VALIDATION" || code === "CONFLICT") {
        const specific = ruleOrFieldMessage(body, { message, has: exists, locale });
        if (specific) return specific;
      }
      const key = `codes.${code}`;
      return exists(key) ? message(key) : t("unknown");
    },
    [t, message, exists, locale]
  );
}

/** For fetch failures that never produced a response (offline, DNS, dropped connection). */
export function useNetworkError() {
  const t = useTranslations("errors");
  return t("network");
}
