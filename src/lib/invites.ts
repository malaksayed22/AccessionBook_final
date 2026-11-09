import { createHash, randomBytes } from "crypto";

export const INVITE_TTL_DAYS = 7;
export const INVITE_PATH_PREFIX = "/invite/";

export type MemberStatus = "active" | "invited" | "invite-expired" | "deactivated";

/** A fresh one-time token. Only its hash is stored, so a leaked database cannot be used to sign up. */
export function createInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitePath(token: string): string {
  return `${INVITE_PATH_PREFIX}${token}`;
}

/**
 * Pending invitees are stored inactive, so "deactivated" means inactive with no
 * outstanding invite — the same flag, told apart by the token.
 */
export function memberStatus(user: {
  active: boolean;
  inviteTokenHash: string | null;
  inviteExpiresAt: Date | null;
}): MemberStatus {
  if (user.active) return "active";
  if (!user.inviteTokenHash) return "deactivated";
  const live = user.inviteExpiresAt && user.inviteExpiresAt.getTime() > Date.now();
  return live ? "invited" : "invite-expired";
}

// The browser-safe validators live apart from this file, which imports Node's crypto.
export { isValidEmail, isValidUsername } from "./member-validation";

// --- Pseudonymised members ----------------------------------------------------------------------

const PSEUDONYM_PATTERN = /^Former member (\d{4,})$/;

/**
 * The stable stand-in for a member whose personal data was erased. It is derived from the row id, so
 * it is unique and never changes, and the audit trail keeps the name as it was written at the time.
 */
export function pseudonymFor(memberId: number): string {
  return `Former member ${String(memberId).padStart(4, "0")}`;
}

/** The number in a pseudonym ("0042"), or null when the name is an ordinary one. */
export function pseudonymNumber(name: string): string | null {
  return PSEUDONYM_PATTERN.exec(name)?.[1] ?? null;
}
