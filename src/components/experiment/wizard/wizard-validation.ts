import {
  findGroupIssue,
  findSourceIssue,
  MAX_INTAKE_UNITS,
  totalIntakeUnits,
  type IntakeIssue,
  type IntakeIssueCode,
} from "@/lib/experiment-intake";
import {
  checkCapacity,
  toIntakeGroup,
  WIZARD_STEPS,
  type WizardState,
  type WizardStep,
} from "./wizard-state";

/*
 * The wizard's validation, in one place. Every rule returns an issue code plus the numbers its
 * sentence needs; the components translate it (`experiments.wizard.errors.<code>`). The unit and
 * source rules come from `lib/experiment-intake`, the same module the server runs, so the form and
 * the API cannot disagree. The server still validates everything again.
 */

export const NAME_MAX = 200;
export const NOTES_MAX = 2000;
export const SOURCE_DESCRIPTION_MAX = 2000;

export type FieldIssue = {
  code: string;
  values?: Record<string, string | number>;
};

/** Issues by field path: "name", "endDate", "groups", "groups.0.quantity", "location", ... */
export type StepErrors = Record<string, FieldIssue>;

export type ValidationContext = {
  locations: ReadonlyArray<{ id: number; capacity: number | null; occupancy: number }>;
  /** The server refused the last attempt because the location is over capacity. */
  capacityConflict?: boolean;
};

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

export function validateIdentity(state: WizardState): StepErrors {
  const errors: StepErrors = {};
  const name = state.name.trim();
  if (!name) errors.name = { code: "name_required" };
  else if (name.length > NAME_MAX)
    errors.name = { code: "name_too_long", values: { max: NAME_MAX } };

  if (!state.startDate) errors.startDate = { code: "start_required" };
  else if (!isDay(state.startDate)) errors.startDate = { code: "date_invalid" };

  if (state.estimatedEndDate) {
    if (!isDay(state.estimatedEndDate)) errors.estimatedEndDate = { code: "date_invalid" };
    else if (!errors.startDate && state.estimatedEndDate < state.startDate) {
      errors.estimatedEndDate = { code: "estimate_before_start" };
    }
  }

  if (state.comment.trim().length > NOTES_MAX) {
    errors.comment = { code: "comment_too_long", values: { max: NOTES_MAX } };
  }
  if (state.parentExperimentId && !Number.isInteger(Number(state.parentExperimentId))) {
    errors.parentExperimentId = { code: "parent_invalid" };
  }
  return errors;
}

/** Which input an intake issue belongs to, as a path under the unit group (or the experiment). */
const ISSUE_FIELD: Record<IntakeIssueCode, string> = {
  location_required: "location",
  supplier_required: "supplier",
  too_many_units: "groups",
  unknown_kind: "kind",
  quantity_invalid: "quantity",
  cultivar_required: "cultivar",
  cultivar_split_missing: "cultivar",
  cultivar_split_invalid: "cultivar",
  cultivar_split_count: "cultivar",
  cultivar_split_sum: "cultivar",
  status_required: "status",
  status_split_missing: "status",
  status_split_invalid: "status",
  status_split_count: "status",
  status_split_sum: "status",
  seeds_invalid: "seedsPerLot",
  weight_wet_invalid: "wetWeightGrams",
  weight_required: "wetWeightGrams",
  weight_dry_invalid: "dryWeightGrams",
};

function pathOf(issue: IntakeIssue): string {
  const field = ISSUE_FIELD[issue.code];
  return issue.group === undefined ? field : `groups.${issue.group}.${field}`;
}

function toFieldIssue(issue: IntakeIssue): FieldIssue {
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(issue.params ?? {})) {
    if (value !== undefined && name !== "status") values[name] = value;
  }
  return { code: issue.code, values };
}

export function validateUnits(state: WizardState): StepErrors {
  const errors: StepErrors = {};
  const groups = state.groups.map(toIntakeGroup);
  const total = totalIntakeUnits(groups);
  if (total > MAX_INTAKE_UNITS) {
    errors.groups = { code: "too_many_units", values: { max: MAX_INTAKE_UNITS, total } };
  }
  groups.forEach((group, index) => {
    const issue = findGroupIssue(group, index);
    if (issue) errors[pathOf(issue)] = toFieldIssue(issue);
  });
  return errors;
}

export function validateSource(state: WizardState): StepErrors {
  const errors: StepErrors = {};
  const groups = state.groups.map(toIntakeGroup);
  const issue = findSourceIssue({
    locationId: state.locationId ? Number(state.locationId) : null,
    providerMode: state.providerMode,
    providerOrganizationId:
      state.providerMode === "EXTERNAL" && state.providerId ? Number(state.providerId) : null,
    sourceDescription: state.sourceDescription,
    groups,
  });
  if (issue) errors[pathOf(issue)] = toFieldIssue(issue);

  if (state.sourceDescription.trim().length > SOURCE_DESCRIPTION_MAX) {
    errors.sourceDescription = {
      code: "source_description_too_long",
      values: { max: SOURCE_DESCRIPTION_MAX },
    };
  }
  return errors;
}

export function validateReview(state: WizardState, context: ValidationContext): StepErrors {
  const errors: StepErrors = {};
  const location = context.locations.find((l) => String(l.id) === state.locationId);
  const capacity = checkCapacity(location, totalIntakeUnits(state.groups.map(toIntakeGroup)));
  const over = capacity.status === "exceeded" || context.capacityConflict === true;
  if (over && !state.capacityOverride) {
    errors.capacityOverride = { code: "capacity_override_required" };
  }
  return errors;
}

export function validateStep(
  step: WizardStep,
  state: WizardState,
  context: ValidationContext
): StepErrors {
  switch (step) {
    case "identity":
      return validateIdentity(state);
    case "units":
      return validateUnits(state);
    case "source":
      return validateSource(state);
    case "review":
      return validateReview(state, context);
  }
}

/** Errors of every step, in step order. */
export function validateAll(
  state: WizardState,
  context: ValidationContext
): Record<WizardStep, StepErrors> {
  return {
    identity: validateIdentity(state),
    units: validateUnits(state),
    source: validateSource(state),
    review: validateReview(state, context),
  };
}

/** The first step that still has an error, or null when the whole form is valid. */
export function firstInvalidStep(
  state: WizardState,
  context: ValidationContext
): WizardStep | null {
  const all = validateAll(state, context);
  return WIZARD_STEPS.find((step) => Object.keys(all[step]).length > 0) ?? null;
}

export const hasErrors = (errors: StepErrors) => Object.keys(errors).length > 0;
