import { describe, expect, it } from "vitest";
import {
  createInviteToken,
  hashInviteToken,
  invitePath,
  isValidEmail,
  isValidUsername,
  memberStatus,
  pseudonymFor,
  pseudonymNumber,
} from "./invites";

const HOUR = 3_600_000;

describe("invite tokens", () => {
  it("stores only a hash that matches the issued token", () => {
    const { token, tokenHash } = createInviteToken();
    expect(tokenHash).not.toContain(token);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("issues unique, URL-safe, high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createInviteToken().token));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
    }
  });

  it("expires in about seven days", () => {
    const { expiresAt } = createInviteToken();
    const days = (expiresAt.getTime() - Date.now()) / (24 * HOUR);
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("builds the public accept path", () => {
    expect(invitePath("abc")).toBe("/invite/abc");
  });
});

describe("memberStatus", () => {
  const future = new Date(Date.now() + HOUR);
  const past = new Date(Date.now() - HOUR);

  it("treats an active account as active even if stale invite fields remain", () => {
    expect(memberStatus({ active: true, inviteTokenHash: "h", inviteExpiresAt: past })).toBe(
      "active"
    );
  });

  it("separates deactivated from pending by the presence of a token", () => {
    expect(memberStatus({ active: false, inviteTokenHash: null, inviteExpiresAt: null })).toBe(
      "deactivated"
    );
    expect(memberStatus({ active: false, inviteTokenHash: "h", inviteExpiresAt: future })).toBe(
      "invited"
    );
  });

  it("reports an elapsed invite as expired", () => {
    expect(memberStatus({ active: false, inviteTokenHash: "h", inviteExpiresAt: past })).toBe(
      "invite-expired"
    );
    expect(memberStatus({ active: false, inviteTokenHash: "h", inviteExpiresAt: null })).toBe(
      "invite-expired"
    );
  });
});

describe("input validation", () => {
  it.each(["a@b.co", "first.last+tag@lab.example.ca"])("accepts email %s", (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each(["", "nope", "a@b", "a b@c.de", `${"x".repeat(250)}@b.co`])(
    "rejects email %j",
    (value) => {
      expect(isValidEmail(value)).toBe(false);
    }
  );

  it.each(["Jo", "Dr Amira Hassan", "jean-luc.p", "Éloïse Tremblay", "user_01"])(
    "accepts username %s",
    (value) => {
      expect(isValidUsername(value)).toBe(true);
    }
  );

  it.each(["", "x", " leading", "-dash", "a<script>", "a/b", "x".repeat(41)])(
    "rejects username %j",
    (value) => {
      expect(isValidUsername(value)).toBe(false);
    }
  );
});

describe("pseudonyms", () => {
  it("derives a stable, zero-padded name from the member id", () => {
    expect(pseudonymFor(42)).toBe("Former member 0042");
    expect(pseudonymFor(42)).toBe(pseudonymFor(42));
    expect(pseudonymFor(12345)).toBe("Former member 12345");
    expect(pseudonymFor(1)).not.toBe(pseudonymFor(2));
  });

  it("recognises a pseudonym and only a pseudonym", () => {
    expect(pseudonymNumber("Former member 0042")).toBe("0042");
    expect(pseudonymNumber("Former member 12345")).toBe("12345");
    expect(pseudonymNumber("Former member 42")).toBeNull();
    expect(pseudonymNumber("Former member 0042 Jr")).toBeNull();
    expect(pseudonymNumber("former member 0042")).toBeNull();
    expect(pseudonymNumber("Amira")).toBeNull();
  });

  it("is a valid username, so the reserved name must be refused elsewhere", () => {
    expect(isValidUsername(pseudonymFor(7))).toBe(true);
  });
});
