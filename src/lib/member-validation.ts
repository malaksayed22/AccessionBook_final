/**
 * Checks on what an administrator types when inviting a member. Pure and free of Node modules, so the
 * invite form in the browser and the service on the server apply exactly the same rules.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Letters, digits, spaces and . _ - — what a person would type as a sign-in name. */
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,39}$/u;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}
