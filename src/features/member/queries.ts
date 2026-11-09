import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionLevel } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { memberStatus } from "@/lib/invites";
import { likeEscape } from "@/lib/search-text";
import { experimentReadScope, isAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { listActiveSessions } from "@/server/session";

export const MEMBER_LIST_STATUSES = ["active", "invited", "deactivated"] as const;
export type MemberListStatus = (typeof MEMBER_LIST_STATUSES)[number];
export const MEMBER_LIST_ACCESS = [
  "ADMIN",
  "REGULAR",
  "QA",
  "INVENTORY",
  "INSPECTOR",
] as const satisfies PermissionLevel[];
export const MEMBER_LIST_SORTS = ["name", "access", "experiments"] as const;
export type MemberListSort = (typeof MEMBER_LIST_SORTS)[number];

export type MemberListParams = {
  q?: string;
  status?: MemberListStatus;
  access?: PermissionLevel;
  sort: MemberListSort;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

export type MemberListRow = {
  id: number;
  /** Short code made by the database. */
  code: string;
  name: string;
  /** Administrators only. */
  email: string | null;
  access: PermissionLevel;
  status: "active" | "invited" | "deactivated";
  /** An invitation nobody accepted in time. */
  inviteExpired: boolean;
  experimentCount: number;
  /** The first few experiment codes, for the list. */
  experimentCodes: string[];
  experimentRefs: Array<{ id: number; ecode: string }>;
};

function statusWhere(status: MemberListStatus | undefined): Prisma.UserWhereInput {
  switch (status) {
    case "active":
      return { active: true };
    case "invited":
      return { active: false, inviteTokenHash: { not: null } };
    case "deactivated":
      return { active: false, inviteTokenHash: null };
    default:
      return {};
  }
}

function orderByFor(
  sort: MemberListSort,
  order: "asc" | "desc"
): Prisma.UserOrderByWithRelationInput[] {
  const primary: Prisma.UserOrderByWithRelationInput =
    sort === "access"
      ? { permissions: order }
      : sort === "experiments"
        ? { experiments: { _count: order } }
        : { name: order };
  return [primary, { id: order }];
}

/**
 * One page of members. Everyone sees the active members by name and role; invitations, deactivated
 * accounts and e-mail addresses are for administrators, and the query enforces it (a member who
 * asks for another status gets the active members).
 */
export async function listMembers(
  viewer: SessionUser,
  params: MemberListParams
): Promise<{ rows: MemberListRow[]; total: number }> {
  const admin = isAdmin(viewer);
  const status = admin ? params.status : "active";
  const needle = params.q?.trim() ? likeEscape(params.q.trim()) : undefined;
  const where: Prisma.UserWhereInput = {
    AND: [
      statusWhere(status),
      params.access ? { permissions: params.access } : {},
      needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" } },
              { code: { contains: needle, mode: "insensitive" } },
              ...(admin ? [{ email: { contains: needle, mode: "insensitive" as const } }] : []),
            ],
          }
        : {},
    ],
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: orderByFor(params.sort, params.order),
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        code: true,
        name: true,
        email: true,
        permissions: true,
        active: true,
        inviteExpiresAt: true,
        experiments: {
          take: 3,
          orderBy: { experiment: { ecode: "asc" } },
          select: { experiment: { select: { id: true, ecode: true } } },
        },
        _count: { select: { experiments: true } },
      },
    }),
  ]);

  // The invitation token hash is never loaded; only whether one exists, for this page's members.
  const pending = users.length
    ? await prisma.user.findMany({
        where: { id: { in: users.map((u) => u.id) }, inviteTokenHash: { not: null } },
        select: { id: true },
      })
    : [];
  const hasInvite = new Set(pending.map((u) => u.id));

  return {
    total,
    rows: users.map((u) => {
      const state = memberStatus({
        active: u.active,
        inviteTokenHash: hasInvite.has(u.id) ? "pending" : null,
        inviteExpiresAt: u.inviteExpiresAt,
      });
      return {
        id: u.id,
        code: u.code,
        name: u.name,
        email: admin ? u.email : null,
        access: u.permissions,
        status: state === "invite-expired" ? "invited" : state,
        inviteExpired: state === "invite-expired",
        experimentCount: u._count.experiments,
        experimentCodes: u.experiments.map((e) => e.experiment.ecode),
        experimentRefs: u.experiments.map((e) => e.experiment),
      };
    }),
  };
}

export type MemberActivityRow = {
  id: number;
  createdAt: Date;
  action: string;
  summary: string;
  entityType: string;
  entityLabel: string;
};

export type MemberDetail = {
  id: number;
  /** Short code made by the database. */
  code: string;
  name: string;
  access: PermissionLevel;
  status: "active" | "invited" | "deactivated";
  inviteExpired: boolean;
  experiments: Array<{
    role: "LEAD" | "MEMBER";
    id: number;
    ecode: string;
    name: string;
    endDate: Date | null;
    units: number;
  }>;
  /** How many experiments the member is on in all (the list above shows the most recent). */
  experimentTotal: number;
  /** Present for administrators and for the member looking at themselves. */
  security: {
    mfaEnabled: boolean;
    activeSessions: number;
    lastLoginAt: Date | null;
    passwordChangedAt: Date | null;
  } | null;
  /** Administrators only. */
  admin: {
    email: string | null;
    invitedAt: Date | null;
    inviteExpiresAt: Date | null;
    createdAt: Date;
  } | null;
  /** What this member did, newest first. Administrators and the member themselves only. */
  activity: MemberActivityRow[] | null;
};

const ACTIVITY_LIMIT = 15;
/** The profile lists this member's most recent experiments; the experiments page has them all. */
export const MEMBER_EXPERIMENT_LIMIT = 20;

export async function getMemberDetail(
  viewer: SessionUser,
  memberId: number
): Promise<MemberDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      code: true,
      name: true,
      email: true,
      permissions: true,
      active: true,
      inviteExpiresAt: true,
      invitedAt: true,
      createdAt: true,
      lastLoginAt: true,
      passwordChangedAt: true,
      mfaEnabledAt: true,
      experiments: {
        // Another member only sees the experiments they share with this one.
        where:
          isAdmin(viewer) || viewer.id === memberId
            ? {}
            : { experiment: experimentReadScope(viewer) },
        orderBy: { experiment: { startDate: "desc" } },
        take: MEMBER_EXPERIMENT_LIMIT,
        select: {
          role: true,
          experiment: {
            select: {
              id: true,
              ecode: true,
              name: true,
              endDate: true,
              _count: { select: { units: true } },
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const admin = isAdmin(viewer);
  const experimentTotal = await prisma.experimentMember.count({
    where: {
      userId: user.id,
      ...(admin || viewer.id === user.id ? {} : { experiment: experimentReadScope(viewer) }),
    },
  });
  const mayLookInside = admin || viewer.id === user.id;
  const hasInvite =
    (await prisma.user.count({ where: { id: user.id, inviteTokenHash: { not: null } } })) > 0;
  const state = memberStatus({
    active: user.active,
    inviteTokenHash: hasInvite ? "pending" : null,
    inviteExpiresAt: user.inviteExpiresAt,
  });

  // Invitations and deactivated accounts are an administrator's business.
  if (!mayLookInside && state !== "active") return null;

  const [sessions, activity] = mayLookInside
    ? await Promise.all([
        listActiveSessions(user.id),
        prisma.auditLog.findMany({
          where: { userId: user.id, entityType: { not: "auth" } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: ACTIVITY_LIMIT,
          select: {
            id: true,
            createdAt: true,
            action: true,
            summary: true,
            entityType: true,
            entityLabel: true,
          },
        }),
      ])
    : [null, null];

  return {
    id: user.id,
    code: user.code,
    name: user.name,
    access: user.permissions,
    status: state === "invite-expired" ? "invited" : state,
    inviteExpired: state === "invite-expired",
    experiments: user.experiments.map((m) => ({
      role: m.role,
      id: m.experiment.id,
      ecode: m.experiment.ecode,
      name: m.experiment.name,
      endDate: m.experiment.endDate,
      units: m.experiment._count.units,
    })),
    experimentTotal,
    security: sessions
      ? {
          mfaEnabled: user.mfaEnabledAt !== null,
          activeSessions: sessions.length,
          lastLoginAt: user.lastLoginAt,
          passwordChangedAt: user.passwordChangedAt,
        }
      : null,
    admin: admin
      ? {
          email: user.email,
          invitedAt: user.invitedAt,
          inviteExpiresAt: user.inviteExpiresAt,
          createdAt: user.createdAt,
        }
      : null,
    activity,
  };
}
