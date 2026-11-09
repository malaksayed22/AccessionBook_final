/**
 * Chooses the catalog message for a refused request. Pure (the translator is passed in), so it is
 * unit tested; `useApiError` in `api-error.ts` wires it to next-intl.
 *
 * Order of preference for a validation or conflict answer:
 *   1. a business-rule `reason` the catalog knows (phrased in the reader's language, with values);
 *   2. the first schema issue, naming the field when the catalog has a label for it;
 *   3. in English, the server's own sentence (written for users, and in the same language);
 *   4. the generic message for the code.
 */
export type SchemaIssue = {
  path?: Array<string | number>;
  code?: string;
  origin?: string;
  minimum?: number;
  maximum?: number;
};

export type ErrorTextInput = {
  code?: string;
  error?: string;
  issues?: SchemaIssue[];
  params?: { reason?: string; values?: Record<string, string | number> } | null;
};

export type Translator = {
  message: (key: string, values?: Record<string, unknown>) => string;
  has: (key: string) => boolean;
  locale: string;
};

/** The catalog key for what is wrong with a field, from a schema issue. */
export function issueKey(issue: SchemaIssue): string {
  switch (issue.code) {
    case "too_small":
      return issue.origin === "string" && (issue.minimum ?? 1) <= 1 ? "required" : "tooSmall";
    case "too_big":
      return issue.origin === "string" ? "tooLong" : "tooBig";
    case "invalid_type":
      return "required";
    default:
      return "invalid";
  }
}

function fieldName(issue: SchemaIssue): string | undefined {
  const named = [...(issue.path ?? [])].reverse().find((p) => typeof p === "string");
  return typeof named === "string" ? named : undefined;
}

/** The message for a VALIDATION or CONFLICT answer, or undefined to fall back to the code's text. */
export function ruleOrFieldMessage(body: ErrorTextInput, t: Translator): string | undefined {
  const reason = body.params?.reason;
  if (reason && t.has(`reasons.${reason}`)) {
    return t.message(`reasons.${reason}`, body.params?.values ?? {});
  }

  const issue = body.issues?.[0];
  if (issue) {
    const field = fieldName(issue);
    if (field && t.has(`fields.${field}`)) {
      return t.message("fieldIssue", {
        field: t.message(`fields.${field}`),
        problem: t.message(`fieldIssues.${issueKey(issue)}`, {
          minimum: issue.minimum ?? 0,
          maximum: issue.maximum ?? 0,
        }),
      });
    }
    return undefined;
  }

  if (t.locale === "en" && body.error) return body.error;
  return undefined;
}
