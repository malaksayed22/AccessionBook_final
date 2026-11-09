import "server-only";
import { prisma } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window counters in PostgreSQL, so limits hold across every app instance and survive
 * restarts. One atomic upsert per hit; no read-modify-write race.
 */
export type Limit = { limit: number; windowSeconds: number };

export type Hit = { count: number; resetAt: Date; exceeded: boolean };

export async function hit(key: string, { limit, windowSeconds }: Limit): Promise<Hit> {
  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= now()
                       THEN now() + make_interval(secs => ${windowSeconds})
                       ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count", "resetAt"`;
  const row = rows[0]!;
  return { count: row.count, resetAt: row.resetAt, exceeded: row.count > limit };
}

/** Reads a bucket without counting. Expired buckets read as empty. */
export async function peek(key: string, limit: number): Promise<Hit> {
  const row = await prisma.rateLimitBucket.findUnique({ where: { key } });
  if (!row || row.resetAt.getTime() <= Date.now()) {
    return { count: 0, resetAt: new Date(), exceeded: false };
  }
  return { count: row.count, resetAt: row.resetAt, exceeded: row.count >= limit };
}

export async function clear(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}

export function rateLimited(resetAt: Date): AppError {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  return new AppError("RATE_LIMITED", "Too many attempts. Please wait and try again.", {
    retryAfterSeconds,
  });
}

/** Counts a hit and throws RATE_LIMITED when the bucket is over its limit. */
export async function enforce(key: string, config: Limit): Promise<void> {
  const result = await hit(key, config);
  if (result.exceeded) throw rateLimited(result.resetAt);
}

/** Housekeeping for expired buckets. */
export async function purgeExpiredBuckets() {
  const result = await prisma.rateLimitBucket.deleteMany({
    where: { resetAt: { lt: new Date() } },
  });
  return result.count;
}
