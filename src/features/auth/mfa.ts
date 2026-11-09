import "server-only";
import { randomInt } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { BRAND } from "@/lib/brand";
import { verifyPassword } from "@/lib/password";
import { recordAuthEvent, type RequestMeta } from "@/server/audit";
import { decryptSecret, encryptSecret, sha256 } from "@/server/crypto";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { errors } from "@/server/errors";
import * as rateLimit from "@/server/rate-limit";
import { markMfaVerified, revokeUserSessions } from "@/server/session";

/**
 * Two-step verification: TOTP (RFC 6238) with single-use recovery codes. The secret is stored
 * AES-256-GCM encrypted; a code is accepted once (the last used time step is remembered) so a
 * shoulder-surfed or intercepted code cannot be replayed.
 */
const PERIOD = 30;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** Wrong codes allowed per window before the account's second step locks. */
const ATTEMPT_LIMIT = { limit: 5, windowSeconds: 15 * 60 };

const attemptKey = (userId: number) => `mfa:${userId}`;

function totpFor(secretBase32: string, label: string) {
  return new OTPAuth.TOTP({
    issuer: BRAND.name,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** Generates "abcd-efgh-jkmn" style codes (~59 bits each). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from(
      { length: 12 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]!
    );
    return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
      .map((part) => part.join(""))
      .join("-");
  });
}

const normaliseRecoveryCode = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

async function storeRecoveryCodes(userId: number, codes: string[]) {
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: sha256(normaliseRecoveryCode(code)) })),
    }),
  ]);
}

/** Checks a TOTP against a stored secret, once per time step. Returns the accepted step or null. */
export function matchTotp(secretBase32: string, code: string, now = Date.now()): number | null {
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const delta = totpFor(secretBase32, "check").validate({
    token: cleaned,
    window: 1,
    timestamp: now,
  });
  if (delta === null) return null;
  return Math.floor(now / 1000 / PERIOD) + delta;
}

async function consumeTotp(userId: number, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaSecretEnc: true },
  });
  if (!user?.mfaSecretEnc) return false;
  const step = matchTotp(decryptSecret(user.mfaSecretEnc), code);
  if (step === null) return false;
  // Atomic: of two simultaneous submissions of the same code, only one updates a row.
  const claimed = await prisma.user.updateMany({
    where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
    data: { mfaLastStep: step },
  });
  return claimed.count === 1;
}

async function consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length !== 12) return false;
  const claimed = await prisma.mfaRecoveryCode.updateMany({
    where: { userId, codeHash: sha256(normalised), usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1;
}

type Account = { id: number; name: string; permissions: string };

/**
 * Verifies a second factor (TOTP, or an unused recovery code) with attempt limiting. Used at
 * sign-in and for sensitive operations. Throws RATE_LIMITED, or returns false for a wrong code.
 */
export async function verifySecondFactor(
  account: Account,
  code: string,
  meta?: RequestMeta
): Promise<{ ok: boolean; usedRecoveryCode: boolean }> {
  const key = attemptKey(account.id);
  const state = await rateLimit.peek(key, ATTEMPT_LIMIT.limit);
  if (state.exceeded) throw rateLimit.rateLimited(state.resetAt);

  const trimmed = code.trim();
  const isTotp = /^\d[\d\s]*$/.test(trimmed);
  const ok = isTotp
    ? await consumeTotp(account.id, trimmed)
    : await consumeRecoveryCode(account.id, trimmed);

  if (ok) {
    await rateLimit.clear(key);
    return { ok: true, usedRecoveryCode: !isTotp };
  }
  const failure = await rateLimit.hit(key, ATTEMPT_LIMIT);
  await recordAuthEvent({
    ...meta,
    userId: account.id,
    userName: account.name,
    role: account.permissions,
    action: failure.count >= ATTEMPT_LIMIT.limit ? "mfa-locked" : "mfa-failed",
    summary:
      failure.count >= ATTEMPT_LIMIT.limit
        ? `${account.name} entered too many wrong verification codes; second step locked for 15 minutes`
        : `${account.name} entered a wrong verification code`,
  });
  return { ok: false, usedRecoveryCode: false };
}

/** Completes the second step of sign-in on a pending session. */
export async function completeSignIn(
  account: Account,
  sessionId: number,
  code: string,
  meta?: RequestMeta
) {
  const result = await verifySecondFactor(account, code, meta);
  if (!result.ok) throw errors.invalidCode();
  await markMfaVerified(sessionId);
  await recordAuthEvent({
    ...meta,
    userId: account.id,
    userName: account.name,
    role: account.permissions,
    action: result.usedRecoveryCode ? "mfa-recovery-used" : "mfa-verified",
    summary: result.usedRecoveryCode
      ? `${account.name} signed in with a recovery code`
      : `${account.name} completed two-step verification`,
  });
  const remaining = result.usedRecoveryCode
    ? await prisma.mfaRecoveryCode.count({ where: { userId: account.id, usedAt: null } })
    : undefined;
  return { recoveryCodesRemaining: remaining };
}

/** Step one of enrolment: a fresh secret, stored encrypted but inactive until confirmed. */
export async function beginEnrolment(account: Account, meta?: RequestMeta) {
  const current = await prisma.user.findUnique({
    where: { id: account.id },
    select: { mfaEnabledAt: true },
  });
  if (current?.mfaEnabledAt) {
    throw errors.mfaAlreadyOn();
  }
  const secret = new OTPAuth.Secret({ size: 20 });
  await prisma.user.update({
    where: { id: account.id },
    data: { mfaSecretEnc: encryptSecret(secret.base32), mfaLastStep: null },
  });
  const uri = totpFor(secret.base32, account.name).toString();
  await recordAuthEvent({
    ...meta,
    userId: account.id,
    userName: account.name,
    role: account.permissions,
    action: "mfa-setup-started",
    summary: `${account.name} started setting up two-step verification`,
  });
  return {
    secret: secret.base32,
    uri,
    qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }),
  };
}

/** Step two: the user proves the authenticator works; MFA turns on and recovery codes are issued. */
export async function confirmEnrolment(
  account: Account,
  sessionId: number,
  code: string,
  meta?: RequestMeta
) {
  const user = await prisma.user.findUnique({
    where: { id: account.id },
    select: { mfaSecretEnc: true, mfaEnabledAt: true },
  });
  if (!user?.mfaSecretEnc || user.mfaEnabledAt) {
    throw errors.mfaNoPendingSetup();
  }
  const key = attemptKey(account.id);
  const state = await rateLimit.peek(key, ATTEMPT_LIMIT.limit);
  if (state.exceeded) throw rateLimit.rateLimited(state.resetAt);

  const step = matchTotp(decryptSecret(user.mfaSecretEnc), code);
  if (step === null) {
    await rateLimit.hit(key, ATTEMPT_LIMIT);
    throw errors.invalidCode();
  }
  await prisma.user.update({
    where: { id: account.id },
    data: { mfaEnabledAt: new Date(), mfaLastStep: step },
  });
  const codes = generateRecoveryCodes();
  await storeRecoveryCodes(account.id, codes);
  await markMfaVerified(sessionId);
  // Anything that signed in without this second factor is no longer trustworthy.
  await revokeUserSessions(account.id, "mfa-enabled", { exceptSessionId: sessionId });
  await recordAuthEvent({
    ...meta,
    userId: account.id,
    userName: account.name,
    role: account.permissions,
    action: "mfa-enabled",
    summary: `${account.name} turned on two-step verification`,
  });
  return { recoveryCodes: codes };
}

export async function regenerateRecoveryCodes(account: Account, code: string, meta?: RequestMeta) {
  const result = await verifySecondFactor(account, code, meta);
  if (!result.ok) throw errors.invalidCode();
  const codes = generateRecoveryCodes();
  await storeRecoveryCodes(account.id, codes);
  await recordAuthEvent({
    ...meta,
    userId: account.id,
    userName: account.name,
    role: account.permissions,
    action: "mfa-recovery-regenerated",
    summary: `${account.name} generated new recovery codes`,
  });
  return { recoveryCodes: codes };
}

/** Turning MFA off needs the password and a current code; administrators cannot where it is mandatory. */
export async function disableMfa(
  account: Account,
  input: { password: string; code: string },
  meta?: RequestMeta
) {
  if (account.permissions === "ADMIN" && env().REQUIRE_ADMIN_MFA) {
    throw errors.mfaMandatory();
  }
  const user = await prisma.user.findUnique({
    where: { id: account.id },
    select: { passwordHash: true, mfaEnabledAt: true },
  });
  if (!user?.mfaEnabledAt) throw errors.mfaNotOn();
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw errors.incorrectPassword();
  }
  const result = await verifySecondFactor(account, input.code, meta);
  if (!result.ok) throw errors.invalidCode();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: account.id },
      data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null },
    }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: account.id } }),
  ]);
  await recordAuthEvent({
    ...meta,
    userId: account.id,
    userName: account.name,
    role: account.permissions,
    action: "mfa-disabled",
    summary: `${account.name} turned off two-step verification`,
  });
}
