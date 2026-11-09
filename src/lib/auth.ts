import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import type { Role } from "@/lib/roles";
import { resolveSession, type ResolvedSession } from "@/server/session";
import { sessionCookieName, sessionCookieOptions } from "@/server/session-cookie";

/**
 * Request-bound session helpers over the database-backed sessions in `@/server/session`.
 * Permission rules live in `@/server/authz`; the two `canEdit*` helpers here only answer "should
 * the UI offer an edit button?".
 */
export type SessionUser = {
  id: number;
  name: string;
  permissions: Role;
};

/** Sets the session cookie. Call from a route handler or server action after creating a session. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  cookieStore.set(sessionCookieName(), token, sessionCookieOptions(maxAge));
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName());
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName())?.value;
}

/**
 * The session behind this request, whatever its state: pending second factor and required
 * enrolment included. Only the sign-in/MFA endpoints should work with a non-active one.
 */
export async function getSession(): Promise<ResolvedSession | null> {
  return resolveSession(await readSessionToken());
}

/** The signed-in user, or null unless the session is fully usable (second factor done). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session || session.state !== "active") return null;
  const { id, name, permissions } = session.user;
  return { id, name, permissions };
}

/**
 * For server components: the signed-in user, or a redirect to sign-in (which resumes a pending
 * second step). Every page that reads data calls this; the proxy only checks cookie presence.
 */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.permissions === "ADMIN";
}

export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSession();
  if (!isAdmin(user)) throw new Error("FORBIDDEN");
  return user;
}

async function isMember(userId: number, experimentId: number): Promise<boolean> {
  const membership = await prisma.experimentMember.findUnique({
    where: { experimentId_userId: { experimentId, userId } },
    select: { userId: true },
  });
  return membership !== null;
}

async function isActiveAdmin(userId: number): Promise<boolean | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, active: true },
    select: { permissions: true },
  });
  return user ? user.permissions === "ADMIN" : null;
}

/** UI hint: may this member edit the unit (admin, or member of its experiment)? */
export async function canEditUnit(userId: number, unitId: number): Promise<boolean> {
  const admin = await isActiveAdmin(userId);
  if (admin === null) return false;
  if (admin) return true;
  const unit = await prisma.biologicalUnit.findUnique({
    where: { id: unitId },
    select: { experimentId: true },
  });
  return unit?.experimentId ? isMember(userId, unit.experimentId) : false;
}

/** UI hint: may this member edit the experiment (admin, or one of its members)? */
export async function canEditExperiment(userId: number, experimentId: number): Promise<boolean> {
  const admin = await isActiveAdmin(userId);
  if (admin === null) return false;
  return admin || isMember(userId, experimentId);
}
