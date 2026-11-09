import "server-only";
import type { SessionUser } from "@/lib/auth";
import { buildChanges, recordAudit, type RequestMeta } from "@/server/audit";
import { assertAdmin } from "@/server/authz";
import { prisma } from "@/server/db";
import { errors } from "@/server/errors";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./schemas";

/** Counterparty organizations (suppliers, recipients). Admin-only; licence numbers feed CTLS. */
type Actor = SessionUser;

export async function createOrganization(
  actor: Actor,
  input: CreateOrganizationInput,
  meta?: RequestMeta
) {
  assertAdmin(actor, "Only admins can register organizations");
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.organization.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (duplicate) {
      throw errors.conflict(`"${duplicate.name}" is already registered — select it from the list`, {
        id: duplicate.id,
      });
    }
    const organization = await tx.organization.create({
      data: {
        name: input.name,
        address: input.address || null,
        country: input.country || null,
        licenceNumber: input.licenceNumber || null,
        licenceClass: input.licenceClass ?? null,
        comment: input.comment || null,
      },
      select: { id: true, name: true },
    });
    await recordAudit(tx, actor, meta, {
      entityType: "organization",
      entityId: organization.id,
      entityLabel: organization.name,
      action: "create",
      summary: `Registered provider organization ${organization.name}`,
      changes: [
        { field: "country", from: null, to: input.country || null },
        { field: "licence", from: null, to: input.licenceNumber || null },
        { field: "licence class", from: null, to: input.licenceClass ?? null },
      ],
    });
    return organization;
  });
}

export async function updateOrganization(
  actor: Actor,
  organizationId: number,
  input: UpdateOrganizationInput,
  meta?: RequestMeta
) {
  assertAdmin(actor, "Only admins can edit organizations");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!existing) throw errors.notFound("Organization");

    const name = input.name ?? existing.name;
    const duplicate = await tx.organization.findFirst({
      where: { NOT: { id: organizationId }, name: { equals: name, mode: "insensitive" } },
      select: { name: true },
    });
    if (duplicate) throw errors.conflict(`"${duplicate.name}" is already registered`);

    const pick = (value: string | undefined, current: string | null) =>
      value === undefined ? current : value || null;
    const data = {
      name,
      address: pick(input.address, existing.address),
      country: pick(input.country, existing.country),
      licenceNumber: pick(input.licenceNumber, existing.licenceNumber),
      licenceClass: input.licenceClass === undefined ? existing.licenceClass : input.licenceClass,
      comment: pick(input.comment, existing.comment),
    };
    const changes = buildChanges([
      { field: "name", from: existing.name, to: data.name },
      { field: "address", from: existing.address, to: data.address },
      { field: "country", from: existing.country, to: data.country },
      { field: "licence", from: existing.licenceNumber, to: data.licenceNumber },
      { field: "licence class", from: existing.licenceClass, to: data.licenceClass },
      { field: "comment", from: existing.comment, to: data.comment },
    ]);
    if (changes.length === 0) {
      return { id: existing.id, name: existing.name, unchanged: true as const };
    }

    const organization = await tx.organization.update({ where: { id: organizationId }, data });
    await recordAudit(tx, actor, meta, {
      entityType: "organization",
      entityId: organization.id,
      entityLabel: organization.name,
      action: "update",
      summary: `Updated organization profile ${organization.name}`,
      changes,
    });
    return { id: organization.id, name: organization.name, unchanged: false as const };
  });
}
