import { z } from "zod";
import { PermissionLevel } from "@/generated/prisma/enums";

export const inviteMemberSchema = z.object({
  name: z.string().trim(),
  email: z.string().trim(),
  // Anything unknown falls back to a plain member: the least access.
  role: z.preprocess(
    (v) =>
      (Object.values(PermissionLevel) as unknown[]).includes(v) ? v : PermissionLevel.REGULAR,
    z.enum(PermissionLevel)
  ),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** Shortest accepted reason for an action that ends or erases access. */
export const REASON_MIN_LENGTH = 10;
const reason = z.string().trim().min(REASON_MIN_LENGTH).max(500);

/** `PATCH /api/members/:id`. Actions that remove access or erase data carry a reason for the audit trail. */
export const memberActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reissue") }),
  z.object({ action: z.literal("deactivate"), reason }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("reset-mfa"), reason }),
  z.object({ action: z.literal("pseudonymise"), reason }),
  z.object({ action: z.literal("role"), role: z.enum(PermissionLevel), reason }),
]);
export type MemberActionInput = z.infer<typeof memberActionSchema>;
export type MemberAction = MemberActionInput["action"];
