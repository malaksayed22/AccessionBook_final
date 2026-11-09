/**
 * Typed application errors. The `code` is a stable identifier the UI translates (English and
 * French); `message` is an English fallback and is safe to show to the user. Anything that is not
 * an AppError is a bug or an outage and is reported to the client as a generic INTERNAL error.
 */
export const ERROR_STATUS = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNIT_ON_HOLD: 409,
  UNIT_NOT_ACTIVE: 409,
  RATE_LIMITED: 429,
  /** Password accepted; the second factor is still to be given. */
  MFA_REQUIRED: 401,
  /** The role requires MFA and the account has none yet. */
  MFA_ENROLMENT_REQUIRED: 403,
  /** A sensitive action needs a fresh password or MFA confirmation. */
  REAUTH_REQUIRED: 403,
  /** Wrong username or password at sign-in (deliberately one answer for every cause). */
  INVALID_CREDENTIALS: 401,
  /** A wrong or already-used verification or recovery code. */
  INVALID_CODE: 400,
  /** The new password fails the policy; `details.issue` says why. */
  PASSWORD_POLICY: 400,
  /** A password confirmation (profile change, re-authentication) was wrong. */
  INCORRECT_PASSWORD: 403,
  INVITE_INVALID: 400,
  USERNAME_UNAVAILABLE: 409,
  MFA_ALREADY_ON: 409,
  MFA_NOT_ON: 409,
  MFA_NO_PENDING_SETUP: 409,
  /** Administrators cannot turn two-step verification off. */
  MFA_MANDATORY: 403,
  /** Experiment code prefix must be 2 to 4 letters. */
  INITIALS_INVALID: 400,
  /** A location cannot be retired while units in inventory are stored there; `details.units` counts them. */
  LOCATION_NOT_EMPTY: 409,
  /** A unit cannot be placed in a retired location. */
  LOCATION_INACTIVE: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

/**
 * Why a business rule refused the input, for the UI to phrase in its own language: `reason` is a
 * key under `errors.reasons` in the message catalogs, `values` fills its placeholders.
 */
export type RuleDetails = { reason: string; values?: Record<string, string | number> };

export function isRuleDetails(details: unknown): details is RuleDetails {
  return (
    typeof details === "object" &&
    details !== null &&
    typeof (details as { reason?: unknown }).reason === "string"
  );
}

export const errors = {
  validation: (message: string, details?: unknown) => new AppError("VALIDATION", message, details),
  /** A business rule refused the input; `message` is the English sentence, `reason` its catalog key. */
  rule: (reason: string, message: string, values?: RuleDetails["values"]) =>
    new AppError("VALIDATION", message, { reason, values } satisfies RuleDetails),
  unauthenticated: () => new AppError("UNAUTHENTICATED", "Sign in required"),
  forbidden: (message = "You do not have permission to do that") =>
    new AppError("FORBIDDEN", message),
  notFound: (what: string) => new AppError("NOT_FOUND", `${what} not found`),
  conflict: (message: string, details?: unknown) => new AppError("CONFLICT", message, details),
  unitOnHold: () =>
    new AppError(
      "UNIT_ON_HOLD",
      "This unit is on quality hold. Release the hold before moving, deriving, changing stage, shipping or destroying it."
    ),
  mfaRequired: () => new AppError("MFA_REQUIRED", "Enter your verification code to continue"),
  mfaEnrolmentRequired: () =>
    new AppError(
      "MFA_ENROLMENT_REQUIRED",
      "Administrator accounts must set up two-step verification before continuing"
    ),
  reauthRequired: () =>
    new AppError("REAUTH_REQUIRED", "Confirm your password to continue with this action"),
  invalidCredentials: () => new AppError("INVALID_CREDENTIALS", "Invalid username or password"),
  invalidCode: () =>
    new AppError("INVALID_CODE", "That code is not valid. Check the code and try again."),
  passwordPolicy: (issue: string, message: string) =>
    new AppError("PASSWORD_POLICY", message, { issue }),
  incorrectPassword: () => new AppError("INCORRECT_PASSWORD", "Current password is incorrect"),
  inviteInvalid: () =>
    new AppError(
      "INVITE_INVALID",
      "This invitation link is invalid or has expired. Ask an admin for a new one."
    ),
  usernameUnavailable: () => new AppError("USERNAME_UNAVAILABLE", "That username is not available"),
  mfaAlreadyOn: () =>
    new AppError(
      "MFA_ALREADY_ON",
      "Two-step verification is already on. Turn it off before setting it up again."
    ),
  mfaNotOn: () => new AppError("MFA_NOT_ON", "Two-step verification is not on"),
  mfaNoPendingSetup: () =>
    new AppError("MFA_NO_PENDING_SETUP", "There is no pending two-step verification setup"),
  mfaMandatory: () =>
    new AppError("MFA_MANDATORY", "Administrators must keep two-step verification on"),
  initialsInvalid: () => new AppError("INITIALS_INVALID", "Code prefix must be 2 to 4 letters"),
  locationNotEmpty: (name: string, units: number) =>
    new AppError("LOCATION_NOT_EMPTY", `${name} still holds ${units} unit(s); move them first`, {
      units,
    }),
  locationInactive: (name: string) =>
    new AppError("LOCATION_INACTIVE", `${name} is not an active location`),
  unitNotActive: (message = "This unit has left inventory and can no longer be changed") =>
    new AppError("UNIT_NOT_ACTIVE", message),
};

/** Messages raised by the database's own integrity triggers (see the integrity migration). */
const DB_INTEGRITY_PATTERN =
  /integrity_constraint_violation|append-only|has left inventory|never deleted|must be \d+|not the newest state|released hold is history/i;

/** Normalises anything thrown into an AppError (or INTERNAL, which hides the cause). */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2002") {
    return errors.conflict("That record already exists");
  }
  if (code === "P2025") {
    return errors.notFound("Record");
  }
  const message = error instanceof Error ? error.message : "";
  if (DB_INTEGRITY_PATTERN.test(message)) {
    return errors.conflict("That change would break a record-keeping rule and was refused");
  }
  return new AppError("INTERNAL", "Something went wrong. Please try again.");
}
