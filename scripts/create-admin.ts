import "dotenv/config";
import { randomBytes } from "node:crypto";
import { isValidEmail, isValidUsername } from "../src/lib/invites";
import { hashPassword, passwordPolicyError } from "../src/lib/password";
import { prisma } from "../src/server/db";

/**
 * Bootstrap or recover an administrator account.
 *
 *   npm run db:admin -- --name admin --email admin@example.com
 *   npm run db:admin -- --name admin --reset            # new password for an existing admin
 *
 * The password comes from ADMIN_PASSWORD, or is generated and printed once. It is never
 * taken from the command line (shell history) and never has a default. Every run is
 * recorded in the audit chain.
 */
function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const name = argValue("--name")?.trim();
  const email = argValue("--email")?.trim();
  const reset = process.argv.includes("--reset");

  if (!name || !isValidUsername(name)) {
    throw new Error("--name is required (2-40 letters, numbers, spaces, . _ -)");
  }

  const supplied = process.env.ADMIN_PASSWORD;
  const generated = !supplied;
  const password = supplied ?? randomBytes(18).toString("base64url");
  const policyError = passwordPolicyError(password, name);
  if (policyError) throw new Error(policyError);
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  let user;
  if (existing) {
    if (!reset)
      throw new Error(`"${existing.name}" already exists. Pass --reset to set a new password.`);
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        permissions: "ADMIN",
        active: true,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
  } else {
    if (!email || !isValidEmail(email)) throw new Error("--email is required to create an admin");
    user = await prisma.user.create({
      data: { name, email, passwordHash, permissions: "ADMIN", active: true },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userName: user.name,
      userRole: "ADMIN",
      entityType: "member",
      entityId: user.id,
      entityLabel: user.name,
      action: existing ? "admin-password-reset" : "admin-bootstrap",
      summary: existing
        ? `Administrator password reset from the command line for ${user.name}`
        : `Administrator ${user.name} created from the command line`,
    },
  });

  console.log(`${existing ? "Reset" : "Created"} administrator "${user.name}" (id ${user.id}).`);
  if (generated) {
    console.log(`Password (shown once, store it in your password manager): ${password}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
