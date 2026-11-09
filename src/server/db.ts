import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({ adapter });
}

/** One client per process; reused across hot reloads in development. */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env().NODE_ENV !== "production") globalForPrisma.prisma = prisma;
