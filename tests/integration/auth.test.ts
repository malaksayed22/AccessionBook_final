import * as OTPAuth from "otpauth";
import { beforeEach, describe, expect, it } from "vitest";
import {
  beginEnrolment,
  completeSignIn,
  confirmEnrolment,
  disableMfa,
  regenerateRecoveryCodes,
} from "@/features/auth/mfa";
import {
  acceptInvite,
  reauthenticate,
  revokeOtherSessions,
  signIn,
  signOut,
  updateProfile,
} from "@/features/auth/service";
import { deactivateMember, inviteMember, resetMemberMfa } from "@/features/member/service";
import { hashPassword } from "@/lib/password";
import { decryptSecret } from "@/server/crypto";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import * as rateLimit from "@/server/rate-limit";
import {
  createSession,
  isRecentlyConfirmed,
  listActiveSessions,
  markReauthenticated,
  resolveSession,
  revokeUserSessions,
} from "@/server/session";
import { asActor, createLab, resetDatabase, verifyChain } from "./helpers";

const PASSWORD = "correct horse battery staple";
const meta = { ip: "203.0.113.9", userAgent: "vitest", requestId: "req-1" };

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, `expected an AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function makeUser(name: string, role: "ADMIN" | "REGULAR" = "REGULAR") {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
      permissions: role,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
}

/** A current authenticator code for a user, from the secret stored in the database. */
async function totpFor(userId: number, offsetSteps = 0) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(decryptSecret(row.mfaSecretEnc!)),
  });
  return totp.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

/** Enrols MFA for a user the way the UI does, returning the recovery codes. */
async function enrol(user: { id: number; name: string; permissions: import("@/lib/roles").Role }) {
  const session = await createSession({ userId: user.id, requiresMfa: false });
  await beginEnrolment(user, meta);
  // The next time step: the enrolment code itself is then single-use for sign-in tests.
  const result = await confirmEnrolment(user, session.id, await totpFor(user.id, 0), meta);
  return result.recoveryCodes;
}

describe("sessions", () => {
  beforeEach(resetDatabase);

  it("stores only a hash of the token and resolves it back to the user", async () => {
    const user = await makeUser("Ada Lovelace");
    const { token } = await createSession({ userId: user.id, requiresMfa: false });
    const row = await prisma.session.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(43);

    const resolved = await resolveSession(token);
    expect(resolved).toMatchObject({ state: "active", user: { id: user.id, name: user.name } });
  });

  it("rejects missing, forged and numeric-id tokens", async () => {
    const user = await makeUser("Ada Lovelace");
    await createSession({ userId: user.id, requiresMfa: false });
    expect(await resolveSession(undefined)).toBeNull();
    expect(await resolveSession("")).toBeNull();
    expect(await resolveSession(String(user.id))).toBeNull();
    expect(await resolveSession("A".repeat(43))).toBeNull();
  });

  it("ends after the idle timeout and after the absolute lifetime", async () => {
    const user = await makeUser("Ada Lovelace");
    const { token } = await createSession({ userId: user.id, requiresMfa: false });
    const minutes = (n: number) => new Date(Date.now() + n * 60_000);

    expect(await resolveSession(token, minutes(29))).not.toBeNull();
    // That read slid the window; idleness is measured from the last activity.
    expect(await resolveSession(token, minutes(29 + 31))).toBeNull();

    const second = await createSession({ userId: user.id, requiresMfa: false });
    // Active every 20 minutes keeps it alive, until the 12 hour cap.
    for (let m = 20; m <= 700; m += 20) {
      expect(await resolveSession(second.token, minutes(m)), `at ${m} min`).not.toBeNull();
    }
    expect(await resolveSession(second.token, minutes(721))).toBeNull();
  });

  it("stops working when revoked, and when the account is deactivated", async () => {
    const lab = await createLab();
    const member = await makeUser("Grace Hopper");
    const a = await createSession({ userId: member.id, requiresMfa: false });
    const b = await createSession({ userId: member.id, requiresMfa: false });

    expect(await revokeUserSessions(member.id, "test", { exceptSessionId: 0 })).toBe(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();

    const c = await createSession({ userId: member.id, requiresMfa: false });
    await deactivateMember(lab.admin, member.id);
    expect(await resolveSession(c.token)).toBeNull();
    const row = await prisma.session.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.revokedReason).toBe("deactivated");
  });

  it("lists only live sessions", async () => {
    const user = await makeUser("Ada Lovelace");
    await createSession({ userId: user.id, requiresMfa: false });
    await createSession(
      { userId: user.id, requiresMfa: false },
      new Date(Date.now() - 5 * 3600_000)
    );
    expect(await listActiveSessions(user.id)).toHaveLength(1);
  });

  it("tracks recent confirmation for sensitive actions", async () => {
    const user = await makeUser("Ada Lovelace");
    const { id, token } = await createSession({ userId: user.id, requiresMfa: false });
    const session = (await resolveSession(token))!;
    // Signing in counts as a confirmation...
    expect(isRecentlyConfirmed(session)).toBe(true);
    // ...for REAUTH_WINDOW_MINUTES (10) only.
    expect(isRecentlyConfirmed(session, new Date(Date.now() + 11 * 60_000))).toBe(false);
    await markReauthenticated(id, new Date(Date.now() + 11 * 60_000));
    expect(
      isRecentlyConfirmed(
        (await resolveSession(token, new Date(Date.now() + 12 * 60_000)))!,
        new Date(Date.now() + 12 * 60_000)
      )
    ).toBe(true);
  });
});

describe("rate limiting", () => {
  beforeEach(resetDatabase);

  it("counts atomically under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => rateLimit.hit("k", { limit: 10, windowSeconds: 60 }))
    );
    expect(results.filter((r) => r.exceeded)).toHaveLength(15);
    expect(Math.max(...results.map((r) => r.count))).toBe(25);
  });

  it("starts a fresh window once the old one has expired", async () => {
    await rateLimit.hit("k", { limit: 1, windowSeconds: 60 });
    await prisma.rateLimitBucket.update({
      where: { key: "k" },
      data: { resetAt: new Date(Date.now() - 1000) },
    });
    const next = await rateLimit.hit("k", { limit: 1, windowSeconds: 60 });
    expect(next).toMatchObject({ count: 1, exceeded: false });
  });
});

describe("sign-in", () => {
  beforeEach(resetDatabase);

  it("signs in with the right password and records it", async () => {
    const user = await makeUser("Ada Lovelace");
    const result = await signIn({ name: "ada lovelace", password: PASSWORD }, { meta });
    expect(result).toMatchObject({
      next: "offer-enrol",
      user: { id: user.id, name: "Ada Lovelace" },
    });
    expect((await resolveSession(result.token))?.state).toBe("active");

    const entry = await prisma.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    expect(entry).toMatchObject({ action: "login", userId: user.id, ip: meta.ip });
    expect(await verifyChain()).toEqual([]);
  });

  it("accepts the e-mail address instead of the name, with one failure counter per account", async () => {
    const user = await makeUser("Ada Lovelace");
    const byEmail = await signIn(
      { name: "ADA.lovelace@example.com", password: PASSWORD },
      { meta }
    );
    expect(byEmail.user.id).toBe(user.id);

    // Guesses by name and by e-mail count against the same account.
    for (let i = 0; i < 3; i++) {
      await expectCode(
        signIn({ name: "Ada Lovelace", password: "nope nope nope" }, { meta }),
        "INVALID_CREDENTIALS"
      );
    }
    for (let i = 0; i < 2; i++) {
      await expectCode(
        signIn({ name: "ada.lovelace@example.com", password: "nope nope nope" }, { meta }),
        "INVALID_CREDENTIALS"
      );
    }
    await expectCode(
      signIn({ name: "ada.lovelace@example.com", password: PASSWORD }, { meta }),
      "RATE_LIMITED"
    );
  });

  it("gives the same answer for a wrong password, an unknown user and a deactivated user", async () => {
    await makeUser("Ada Lovelace");
    const gone = await makeUser("Grace Hopper");
    await prisma.user.update({ where: { id: gone.id }, data: { active: false } });

    for (const name of ["Ada Lovelace", "Nobody Here", "Grace Hopper"]) {
      const error = await signIn({ name, password: "wrong password!!" }, { meta }).catch((e) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "INVALID_CREDENTIALS",
        message: "Invalid username or password",
      });
    }
  });

  it("locks the account after repeated failures, even for the right password, then recovers", async () => {
    const user = await makeUser("Ada Lovelace");
    for (let i = 0; i < 5; i++) {
      await expectCode(
        signIn({ name: "Ada Lovelace", password: "nope nope nope" }, { meta }),
        "INVALID_CREDENTIALS"
      );
    }
    const locked = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta }).catch(
      (e) => e
    );
    expect(locked).toMatchObject({ code: "RATE_LIMITED" });
    expect((locked as AppError).details).toMatchObject({ retryAfterSeconds: expect.any(Number) });

    const actions = (
      await prisma.auditLog.findMany({ where: { userId: user.id }, orderBy: { seq: "asc" } })
    ).map((a) => a.action);
    expect(actions).toEqual([
      "login-failed",
      "login-failed",
      "login-failed",
      "login-failed",
      "login-locked",
    ]);

    // The window passes; the lock lifts.
    await prisma.rateLimitBucket.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } });
    await expect(
      signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta })
    ).resolves.toMatchObject({ next: "offer-enrol" });
  });

  it("locks out guessing against names that do not exist, without writing audit rows for them", async () => {
    for (let i = 0; i < 5; i++) {
      await expectCode(
        signIn({ name: "Ghost User", password: "nope nope nope" }, { meta }),
        "INVALID_CREDENTIALS"
      );
    }
    await expectCode(
      signIn({ name: "Ghost User", password: "nope nope nope" }, { meta }),
      "RATE_LIMITED"
    );
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("limits one address spraying many accounts", async () => {
    await makeUser("Ada Lovelace");
    for (let i = 0; i < 30; i++) {
      await signIn({ name: `User ${i}`, password: "nope nope nope" }, { meta }).catch(
        () => undefined
      );
    }
    await expectCode(
      signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta }),
      "RATE_LIMITED"
    );
    // Another address is unaffected.
    await expect(
      signIn(
        { name: "Ada Lovelace", password: PASSWORD },
        { meta: { ...meta, ip: "198.51.100.4" } }
      )
    ).resolves.toMatchObject({ next: "offer-enrol" });
  });

  it("replaces the previous session on sign-in instead of reusing it", async () => {
    await makeUser("Ada Lovelace");
    const first = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    const second = await signIn(
      { name: "Ada Lovelace", password: PASSWORD },
      { meta, previousToken: first.token }
    );
    expect(second.token).not.toBe(first.token);
    expect(await resolveSession(first.token)).toBeNull();
    expect(await resolveSession(second.token)).not.toBeNull();
  });

  it("signing out ends the session and is audited", async () => {
    await makeUser("Ada Lovelace");
    const { token } = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    await signOut((await resolveSession(token))!, meta);
    expect(await resolveSession(token)).toBeNull();
    expect((await prisma.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } })).action).toBe(
      "logout"
    );
  });

  it("stores Argon2id hashes and upgrades an outdated hash on sign-in", async () => {
    const user = await makeUser("Ada Lovelace");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toMatch(
      /^\$argon2id\$/
    );

    const weak = "$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHRzb21lc2FsdA$" + "A".repeat(43);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: weak } });
    // A malformed or foreign hash reads as a wrong password, never a crash.
    await expectCode(
      signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta }),
      "INVALID_CREDENTIALS"
    );
  });
});

describe("invitation acceptance", () => {
  beforeEach(resetDatabase);

  it("sets the password once, signs the invitee in and cannot be replayed", async () => {
    const lab = await createLab();
    const invited = await inviteMember(lab.admin, {
      name: "New Person",
      email: "new@example.com",
      role: "REGULAR",
    });
    const token = invited.invitePath.split("/").pop()!;

    const result = await acceptInvite({ token, password: PASSWORD }, meta);
    expect(result.next).toBe("offer-enrol");
    expect((await resolveSession(result.token))?.user.name).toBe("New Person");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: invited.member.id } })).passwordHash
    ).toMatch(/^\$argon2id\$/);

    await expectCode(acceptInvite({ token, password: PASSWORD }, meta), "INVITE_INVALID");
  });

  it("enforces the password policy and sends invited admins to MFA setup", async () => {
    const lab = await createLab();
    const invited = await inviteMember(lab.admin, {
      name: "New Admin",
      email: "newadmin@example.com",
      role: "ADMIN",
    });
    const token = invited.invitePath.split("/").pop()!;
    await expectCode(acceptInvite({ token, password: "short" }, meta), "PASSWORD_POLICY");
    await expectCode(acceptInvite({ token, password: "password1234" }, meta), "PASSWORD_POLICY");

    const result = await acceptInvite({ token, password: PASSWORD }, meta);
    expect(result.next).toBe("enrol");
    expect((await resolveSession(result.token))?.state).toBe("mfa-enrolment-required");
  });

  it("limits guessing of invitation links per address", async () => {
    for (let i = 0; i < 20; i++) {
      await acceptInvite({ token: `bad-${i}`, password: PASSWORD }, meta).catch(() => undefined);
    }
    await expectCode(acceptInvite({ token: "bad-21", password: PASSWORD }, meta), "RATE_LIMITED");
  });
});

describe("two-step verification", () => {
  beforeEach(resetDatabase);

  it("enrols, then requires the code at every sign-in", async () => {
    const user = await makeUser("Ada Lovelace");
    const codes = await enrol(asActor(user));
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaSecretEnc).not.toBeNull();
    expect(row.mfaSecretEnc).toMatch(/^v1\./); // encrypted at rest
    expect(row.mfaEnabledAt).not.toBeNull();

    const login = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    expect(login.next).toBe("mfa");
    const pending = (await resolveSession(login.token))!;
    expect(pending.state).toBe("mfa-required");

    await completeSignIn(asActor(user), pending.id, await totpFor(user.id, 1), meta);
    expect((await resolveSession(login.token))?.state).toBe("active");
  });

  it("accepts a code only once, so it cannot be replayed", async () => {
    const user = await makeUser("Ada Lovelace");
    await enrol(asActor(user));
    const a = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    const b = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    const code = await totpFor(user.id, 1);

    await completeSignIn(asActor(user), (await resolveSession(a.token))!.id, code, meta);
    await expectCode(
      completeSignIn(asActor(user), (await resolveSession(b.token))!.id, code, meta),
      "INVALID_CODE"
    );
    expect((await resolveSession(b.token))?.state).toBe("mfa-required");
  });

  it("locks the second step after repeated wrong codes", async () => {
    const user = await makeUser("Ada Lovelace");
    await enrol(asActor(user));
    const login = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    const session = (await resolveSession(login.token))!;
    for (let i = 0; i < 5; i++) {
      await expectCode(completeSignIn(asActor(user), session.id, "000000", meta), "INVALID_CODE");
    }
    // Even the correct code is refused while locked.
    await expectCode(
      completeSignIn(asActor(user), session.id, await totpFor(user.id, 1), meta),
      "RATE_LIMITED"
    );
    const actions = (
      await prisma.auditLog.findMany({ where: { userId: user.id }, orderBy: { seq: "asc" } })
    ).map((a) => a.action);
    expect(actions).toContain("mfa-locked");
  });

  it("recovery codes work once each", async () => {
    const user = await makeUser("Ada Lovelace");
    const [first, second] = await enrol(asActor(user));
    const a = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    const sessionA = (await resolveSession(a.token))!;
    await expect(
      completeSignIn(asActor(user), sessionA.id, first!.toUpperCase(), meta)
    ).resolves.toEqual({ recoveryCodesRemaining: 9 });

    const b = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    const sessionB = (await resolveSession(b.token))!;
    await expectCode(completeSignIn(asActor(user), sessionB.id, first!, meta), "INVALID_CODE");
    await completeSignIn(asActor(user), sessionB.id, second!, meta);
  });

  it("enrolling ends other sessions that signed in without the second factor", async () => {
    const user = await makeUser("Ada Lovelace");
    const stale = await createSession({ userId: user.id, requiresMfa: false });
    await enrol(asActor(user));
    expect(await resolveSession(stale.token)).toBeNull();
  });

  it("refuses a wrong confirmation code and a second setup while enabled", async () => {
    const user = await makeUser("Ada Lovelace");
    const session = await createSession({ userId: user.id, requiresMfa: false });
    await beginEnrolment(asActor(user), meta);
    await expectCode(confirmEnrolment(asActor(user), session.id, "123456", meta), "INVALID_CODE");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabledAt
    ).toBeNull();

    await confirmEnrolment(asActor(user), session.id, await totpFor(user.id), meta);
    await expectCode(beginEnrolment(asActor(user), meta), "MFA_ALREADY_ON");
  });

  it("regenerating recovery codes retires the old ones", async () => {
    const user = await makeUser("Ada Lovelace");
    const [old] = await enrol(asActor(user));
    const { recoveryCodes } = await regenerateRecoveryCodes(
      asActor(user),
      await totpFor(user.id, 1),
      meta
    );
    expect(recoveryCodes).toHaveLength(10);
    const login = await signIn({ name: "Ada Lovelace", password: PASSWORD }, { meta });
    await expectCode(
      completeSignIn(asActor(user), (await resolveSession(login.token))!.id, old!, meta),
      "INVALID_CODE"
    );
  });

  it("members may turn it off with password and code; administrators may not", async () => {
    const member = await makeUser("Ada Lovelace");
    await enrol(asActor(member));
    await expectCode(
      disableMfa(
        asActor(member),
        { password: "wrong password!!", code: await totpFor(member.id, 1) },
        meta
      ),
      "INCORRECT_PASSWORD"
    );
    await disableMfa(
      asActor(member),
      { password: PASSWORD, code: await totpFor(member.id, 1) },
      meta
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row).toMatchObject({ mfaEnabledAt: null, mfaSecretEnc: null });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: member.id } })).toBe(0);

    const admin = await makeUser("Root Admin", "ADMIN");
    await enrol(asActor(admin));
    await expectCode(
      disableMfa(asActor(admin), { password: PASSWORD, code: await totpFor(admin.id, 1) }, meta),
      "MFA_MANDATORY"
    );
  });

  it("holds administrators in an enrolment-only session until MFA is on", async () => {
    const admin = await makeUser("Root Admin", "ADMIN");
    const login = await signIn({ name: "Root Admin", password: PASSWORD }, { meta });
    expect(login.next).toBe("enrol");
    const session = (await resolveSession(login.token))!;
    expect(session.state).toBe("mfa-enrolment-required");

    await beginEnrolment(asActor(admin), meta);
    await confirmEnrolment(asActor(admin), session.id, await totpFor(admin.id), meta);
    expect((await resolveSession(login.token))?.state).toBe("active");
  });

  it("an admin can reset a member's MFA, which ends their sessions", async () => {
    const lab = await createLab();
    const member = await makeUser("Ada Lovelace");
    await enrol(asActor(member));
    const live = await createSession({ userId: member.id, requiresMfa: false });
    await resetMemberMfa(lab.admin, member.id, meta);
    expect(await resolveSession(live.token)).toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).mfaEnabledAt
    ).toBeNull();
    await expectCode(resetMemberMfa(lab.member, member.id, meta), "FORBIDDEN");
  });
});

describe("profile and re-authentication", () => {
  beforeEach(resetDatabase);

  it("changing the password ends every other session but keeps the current one", async () => {
    const user = await makeUser("Ada Lovelace");
    const here = await createSession({ userId: user.id, requiresMfa: false });
    const elsewhere = await createSession({ userId: user.id, requiresMfa: false });

    const self = asActor(user);
    await updateProfile(
      self,
      here.id,
      { currentPassword: PASSWORD, newPassword: "an entirely new passphrase" },
      meta
    );
    expect(await resolveSession(here.token)).not.toBeNull();
    expect(await resolveSession(elsewhere.token)).toBeNull();
    await expect(
      signIn({ name: "Ada Lovelace", password: "an entirely new passphrase" }, { meta })
    ).resolves.toBeDefined();
  });

  it("needs the current password, and wrong guesses are limited", async () => {
    const user = await makeUser("Ada Lovelace");
    const self = asActor(user);
    for (let i = 0; i < 5; i++) {
      await expectCode(
        updateProfile(
          self,
          1,
          { currentPassword: "wrong wrong wrong", name: "Someone Else" },
          meta
        ),
        "INCORRECT_PASSWORD"
      );
    }
    await expectCode(
      updateProfile(self, 1, { currentPassword: PASSWORD, name: "Someone Else" }, meta),
      "RATE_LIMITED"
    );
  });

  it("does not reveal which usernames exist when renaming", async () => {
    const user = await makeUser("Ada Lovelace");
    await makeUser("Grace Hopper");
    const error = await updateProfile(
      asActor(user),
      1,
      { currentPassword: PASSWORD, name: "grace hopper" },
      meta
    ).catch((e) => e);
    expect(error).toMatchObject({
      code: "USERNAME_UNAVAILABLE",
      message: "That username is not available",
    });
  });

  it("re-authentication marks the session as recently confirmed", async () => {
    const user = await makeUser("Ada Lovelace");
    const { id, token } = await createSession(
      { userId: user.id, requiresMfa: false },
      new Date(Date.now() - 5 * 60_000)
    );
    const before = (await resolveSession(token))!;
    expect(isRecentlyConfirmed(before, new Date(Date.now() + 8 * 60_000))).toBe(false);
    await expectCode(
      reauthenticate(asActor(user), id, "wrong password!!", meta),
      "INCORRECT_PASSWORD"
    );
    await reauthenticate(asActor(user), id, PASSWORD, meta);
    const after = (await resolveSession(token))!;
    expect(isRecentlyConfirmed(after)).toBe(true);
  });

  it("ends every other session but keeps the current one, and records it", async () => {
    const user = await makeUser("Ada Lovelace");
    const here = await createSession({ userId: user.id, requiresMfa: false });
    const phone = await createSession({ userId: user.id, requiresMfa: false });
    const laptop = await createSession({ userId: user.id, requiresMfa: false });
    const someoneElse = await createSession({
      userId: (await makeUser("Grace Hopper")).id,
      requiresMfa: false,
    });

    expect(await revokeOtherSessions(asActor(user), here.id, meta)).toEqual({ ended: 2 });
    expect(await resolveSession(here.token)).not.toBeNull();
    expect(await resolveSession(phone.token)).toBeNull();
    expect(await resolveSession(laptop.token)).toBeNull();
    expect(await resolveSession(someoneElse.token)).not.toBeNull();

    const entry = await prisma.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    expect(entry).toMatchObject({ action: "sessions-revoked", userId: user.id });
    // Nothing else to end: no second audit entry for a no-op.
    const before = await prisma.auditLog.count();
    expect(await revokeOtherSessions(asActor(user), here.id, meta)).toEqual({ ended: 0 });
    expect(await prisma.auditLog.count()).toBe(before);
  });
});
