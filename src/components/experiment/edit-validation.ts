/**
 * Rules for editing an experiment's details, shared by the edit panel and its unit tests. They match
 * `updateExperimentSchema` and `updateExperiment` on the server (which stays the authority). Members
 * edit the name, notes and estimated end; administrators also correct the start day and, on a
 * completed experiment, the completion day.
 */
export const EXPERIMENT_NAME_MAX = 200;
export const EXPERIMENT_NOTES_MAX = 2000;

export type EditField = "name" | "comment" | "startDate" | "endDate" | "estimatedEndDate";
export type EditIssueCode =
  | "name_required"
  | "name_too_long"
  | "comment_too_long"
  | "date_invalid"
  | "end_before_start"
  | "end_in_future"
  | "estimate_before_start";

export type EditDraft = {
  name: string;
  comment: string;
  /** `YYYY-MM-DD`, or empty for no estimate. */
  estimatedEndDate: string;
  startDate: string;
  /** Empty for a running experiment. */
  endDate: string;
};

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

export function validateEdit(
  draft: EditDraft,
  context: { isAdmin: boolean; today: string }
): Partial<Record<EditField, EditIssueCode>> {
  const issues: Partial<Record<EditField, EditIssueCode>> = {};
  const name = draft.name.trim();
  if (!name) issues.name = "name_required";
  else if (name.length > EXPERIMENT_NAME_MAX) issues.name = "name_too_long";

  if (draft.comment.trim().length > EXPERIMENT_NOTES_MAX) issues.comment = "comment_too_long";

  if (context.isAdmin && !isDay(draft.startDate)) issues.startDate = "date_invalid";
  const start = isDay(draft.startDate) ? draft.startDate : null;

  if (draft.estimatedEndDate) {
    if (!isDay(draft.estimatedEndDate)) issues.estimatedEndDate = "date_invalid";
    else if (start && draft.estimatedEndDate < start) {
      issues.estimatedEndDate = "estimate_before_start";
    }
  }

  if (context.isAdmin && draft.endDate) {
    if (!isDay(draft.endDate)) issues.endDate = "date_invalid";
    else if (start && draft.endDate < start) issues.endDate = "end_before_start";
    else if (draft.endDate > context.today) issues.endDate = "end_in_future";
  }
  return issues;
}
