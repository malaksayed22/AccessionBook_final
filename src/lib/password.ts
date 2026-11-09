import argon2 from "argon2";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-rules";

/**
 * Argon2id with the OWASP-recommended minimum cost (19 MiB, 2 passes, 1 lane). Parameters live in
 * the hash itself, so raising them later only needs `passwordNeedsRehash` to start returning true.
 */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash.
    return false;
  }
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against a throwaway hash so a request for an unknown account costs as much as one for a
 * real account; otherwise response time reveals which usernames exist.
 */
export async function burnPasswordTime(password: string): Promise<void> {
  dummyHash ??= hashPassword("timing-equalisation-placeholder");
  await verifyPassword(password, await dummyHash);
}

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

/** Passwords that meet the length rule but sit at the top of every attacker's list. */
const COMMON = new Set([
  "password1234",
  "password12345",
  "passw0rd1234",
  "123456789012",
  "1234567890123",
  "12345678901234",
  "qwertyuiop12",
  "qwertyuiopas",
  "qwerty123456",
  "qwertyuiop123",
  "abcdefghijkl",
  "abcd12345678",
  "iloveyou1234",
  "letmein12345",
  "welcome12345",
  "administrator",
  "changeme1234",
  "adminadmin12",
  "admin1234567",
  "trustno1trustno1",
  "monkey123456",
  "dragon123456",
  "football1234",
  "baseball1234",
  "111111111111",
  "000000000000",
  "aaaaaaaaaaaa",
  "accessionbook",
  "accessionbook1",
  "accessionbook123",
]);

export type PasswordIssue = "tooShort" | "tooLong" | "containsUsername" | "common" | "repetitive";

const PASSWORD_ISSUE_TEXT: Record<PasswordIssue, string> = {
  tooShort: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  tooLong: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
  containsUsername: "Password must not contain your username",
  common: "That password is too common. Choose something harder to guess",
  repetitive: "Password is too repetitive. Use a longer passphrase",
};

/** Why the password is unacceptable (a stable id the UI translates), or null if it is fine. */
export function passwordPolicyIssue(password: string, username?: string): PasswordIssue | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "tooShort";
  if (password.length > MAX_PASSWORD_LENGTH) return "tooLong";
  const folded = password.toLowerCase();
  if (username && folded.includes(username.trim().toLowerCase())) return "containsUsername";
  if (COMMON.has(folded) || /^(.)\1+$/.test(password)) return "common";
  if (new Set(password).size < 5) return "repetitive";
  return null;
}

/** English text for an issue; the API sends the id and the UI shows its own translation. */
export const passwordIssueText = (issue: PasswordIssue) => PASSWORD_ISSUE_TEXT[issue];

/** Returns an English reason the password is unacceptable, or null if it is fine. */
export function passwordPolicyError(password: string, username?: string): string | null {
  const issue = passwordPolicyIssue(password, username);
  return issue ? PASSWORD_ISSUE_TEXT[issue] : null;
}
