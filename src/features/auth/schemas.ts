import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
/** Passwords are not trimmed: leading and trailing spaces are legitimate characters. */
const password = z.string().min(1).max(256);

export const loginSchema = z.strictObject({ name: text(120), password });

export const acceptInviteSchema = z.strictObject({ token: z.string().min(1).max(200), password });

export const profileSchema = z.strictObject({
  currentPassword: password,
  name: text(40).optional(),
  initials: z.string().max(10).optional(),
  newPassword: password.optional(),
});

export const codeSchema = z.strictObject({ code: text(32) });

export const reauthSchema = z.strictObject({ password });

export const disableMfaSchema = z.strictObject({ password, code: text(32) });
