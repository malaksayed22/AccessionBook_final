import "server-only";
import { SopVersionStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth";
import { isQuality, isReadOnly } from "@/lib/roles";
import { prisma } from "@/server/db";
import { unitReadScope } from "@/server/authz";

/** Who must sign the procedures in effect: every active member except inspectors. */
const STAFF = { active: true, permissions: { not: "INSPECTOR" as const } };

export type SopRow = {
  id: number;
  code: string;
  title: string;
  effective: { version: number; approvedAt: Date } | null;
  /** The draft waiting for approval, if there is one. */
  draftVersion: number | null;
  signed: number;
  staff: number;
  /** Where the reader stands with the version in effect. */
  mine: "signed" | "toSign" | "none";
};

export async function listSops(user: SessionUser): Promise<SopRow[]> {
  const [sops, staff] = await Promise.all([
    prisma.sop.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        title: true,
        versions: {
          where: { status: { in: [SopVersionStatus.EFFECTIVE, SopVersionStatus.DRAFT] } },
          select: {
            version: true,
            status: true,
            approvedAt: true,
            _count: { select: { signoffs: { where: { user: STAFF } } } },
            signoffs: { where: { userId: user.id }, select: { id: true } },
          },
        },
      },
    }),
    prisma.user.count({ where: STAFF }),
  ]);
  return sops.map((sop) => {
    const effective = sop.versions.find((v) => v.status === SopVersionStatus.EFFECTIVE);
    const draft = sop.versions.find((v) => v.status === SopVersionStatus.DRAFT);
    return {
      id: sop.id,
      code: sop.code,
      title: sop.title,
      effective: effective
        ? { version: effective.version, approvedAt: effective.approvedAt! }
        : null,
      draftVersion: draft?.version ?? null,
      signed: effective?._count.signoffs ?? 0,
      staff,
      mine:
        !effective || isReadOnly(user)
          ? "none"
          : effective.signoffs.length > 0
            ? "signed"
            : "toSign",
    };
  });
}

/** How many procedures in effect the member has not signed yet. */
export async function countSopsToSign(user: SessionUser): Promise<number> {
  if (isReadOnly(user)) return 0;
  return prisma.sopVersion.count({
    where: { status: SopVersionStatus.EFFECTIVE, signoffs: { none: { userId: user.id } } },
  });
}

export async function getSop(user: SessionUser, id: number) {
  const sop = await prisma.sop.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      title: true,
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          status: true,
          body: true,
          changeNote: true,
          createdAt: true,
          approvedAt: true,
          supersededAt: true,
          fileName: true,
          fileSize: true,
          createdBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          _count: { select: { signoffs: true } },
        },
      },
    },
  });
  if (!sop) return null;
  const effective = sop.versions.find((v) => v.status === SopVersionStatus.EFFECTIVE) ?? null;
  const draft = sop.versions.find((v) => v.status === SopVersionStatus.DRAFT) ?? null;

  const [staff, signoffs, deviations] = await Promise.all([
    prisma.user.findMany({
      where: STAFF,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    effective
      ? prisma.sopSignoff.findMany({
          where: { versionId: effective.id },
          select: { userId: true, signedAt: true },
        })
      : Promise.resolve([]),
    // Incidents on a unit follow the unit's scope, as everywhere else.
    prisma.qualityIncident.findMany({
      where: {
        sopId: sop.id,
        voidedAt: null,
        OR: [{ unitId: null }, { unit: { is: unitReadScope(user) } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, title: true, severity: true, status: true, createdAt: true },
    }),
  ]);
  const signedAt = new Map(signoffs.map((s) => [s.userId, s.signedAt]));
  return {
    id: sop.id,
    code: sop.code,
    title: sop.title,
    effective,
    draft,
    versions: sop.versions,
    /** Every member and when they signed the version in effect (null: not yet). */
    roster: staff.map((member) => ({ ...member, signedAt: signedAt.get(member.id) ?? null })),
    mySignature: signedAt.get(user.id) ?? null,
    /** Incidents recorded as departures from this procedure, newest first. */
    deviations,
    canWrite: isQuality(user),
    canSign: !isReadOnly(user) && effective !== null,
  };
}

export type SopDetail = NonNullable<Awaited<ReturnType<typeof getSop>>>;
