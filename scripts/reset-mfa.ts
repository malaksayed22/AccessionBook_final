import "dotenv/config";
import { prisma } from "../src/server/db";
import { recordAuthEvent } from "../src/server/audit";

/**
 * Turns two-step verification off for one account, for someone who asks to have it removed (or has
 * lost their authenticator) and cannot do it from their profile. Their sign-in sessions are kept.
 * Recorded on the audit trail as an "mfa-reset". They can turn it on again from their profile.
 *
 *   npm run db:reset-mfa -- --name "<username>"
 */
async function main() {
  const name = process.argv[process.argv.indexOf("--name") + 1];
  if (!name || name.startsWith("--")) throw new Error('Pass --name "<username>"');
  const user = await prisma.user.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, permissions: true, mfaEnabledAt: true },
  });
  if (!user) throw new Error(`No account is named "${name}"`);
  if (!user.mfaEnabledAt) {
    console.log(`${user.name} has no two-step verification; nothing to do.`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null },
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await recordAuthEvent(
      {
        userId: user.id,
        userName: user.name,
        role: user.permissions,
        action: "mfa-reset",
        summary: `Two-step verification turned off for ${user.name} at their request`,
      },
      tx
    );
  });
  console.log(`Two-step verification is off for ${user.name}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
