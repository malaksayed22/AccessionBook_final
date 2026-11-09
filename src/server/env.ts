import "server-only";
import { z } from "zod";
import { isValidTimeZone } from "@/lib/lab-time";

/**
 * The only module that reads `process.env` (see Next.js "data security": keep
 * secrets behind one server-only boundary). Validated once, fails fast with a
 * readable list so a misconfigured deploy never starts half-working.
 */
const flag = z.enum(["true", "false"]).transform((value) => value === "true");

const databaseUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string");
/** Stands in for DATABASE_URL while `next build` runs: the build never connects. */
const BUILD_DATABASE_URL = "postgresql://build@localhost:5432/build";

const makeSchema = (building: boolean) =>
  z
    .object({
      NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
      /** Public origin of the app; used for absolute links (invites) and origin checks. */
      APP_URL: z.url().default("http://localhost:3000"),
      LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),
      /** IANA zone of the laboratory: regulatory days and periods are calendar days here. */
      /** The licence number printed on regulatory reports (CTLS). Optional; reports show a dash without it. */
      LAB_LICENSE_ID: z.string().min(1).optional(),
      LAB_TIMEZONE: z
        .string()
        .default("America/Toronto")
        .refine(isValidTimeZone, "must be an IANA time zone such as America/Toronto"),
      /**
       * PostgreSQL connection string. Required at runtime: there is deliberately no default. The
       * build is the exception, since a container image is built without the runtime secrets.
       */
      DATABASE_URL: building ? databaseUrl.default(BUILD_DATABASE_URL) : databaseUrl,

      // --- Sessions -----------------------------------------------------------------------------
      /** A session ends after this long without activity. */
      SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
      /** A session ends this long after sign-in, whatever its activity. */
      SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),

      /**
       * Reverse proxies between the internet and the app (ALB = 1). The client address is read that
       * many entries from the end of X-Forwarded-For, because earlier entries are client-controlled.
       */
      TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

      // --- Multi-factor authentication and re-authentication -------------------------------------
      /** Admins must enrol TOTP before they can use the application. On by default in production. */
      REQUIRE_ADMIN_MFA: flag.optional(),
      /** Destructive actions need a recent password/MFA confirmation. On by default in production. */
      REQUIRE_REAUTH: flag.optional(),
      /** How recent a confirmation must be for a sensitive action. */
      REAUTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(120).default(10),
      /** 32 random bytes, base64: encrypts TOTP secrets at rest. Mandatory in production. */
      MFA_ENCRYPTION_KEY: z.string().min(1).optional(),

      // --- File storage -------------------------------------------------------------------------
      STORAGE_DRIVER: z.enum(["disk", "s3"]).default("disk"),
      /** Disk driver root (development and tests). */
      STORAGE_DIR: z.string().min(1).default(".local/uploads"),
      S3_BUCKET: z.string().min(1).optional(),
      S3_REGION: z.string().min(1).default("ca-central-1"),
      /** KMS key for server-side encryption; omit to use the bucket default (SSE-S3). */
      S3_KMS_KEY_ID: z.string().min(1).optional(),

      // --- Features -----------------------------------------------------------------------------
      /** Standard operating procedures (Quality > Procedures). Off until the lab adopts them. */
      ENABLE_SOPS: flag.optional(),
    })
    .superRefine((value, ctx) => {
      if (value.STORAGE_DRIVER === "s3" && !value.S3_BUCKET) {
        ctx.addIssue({
          code: "custom",
          path: ["S3_BUCKET"],
          message: "required when STORAGE_DRIVER=s3",
        });
      }
      if (value.NODE_ENV === "production" && !building) {
        if (!value.MFA_ENCRYPTION_KEY) {
          ctx.addIssue({
            code: "custom",
            path: ["MFA_ENCRYPTION_KEY"],
            message: "required in production (32 random bytes, base64)",
          });
        }
        if (!value.APP_URL.startsWith("https://")) {
          ctx.addIssue({
            code: "custom",
            path: ["APP_URL"],
            message: "must be https:// in production",
          });
        }
      }
    })
    .transform((value) => {
      const production = value.NODE_ENV === "production";
      return {
        ...value,
        // Two-step verification is optional unless a deployment turns this on.
        REQUIRE_ADMIN_MFA: value.REQUIRE_ADMIN_MFA ?? false,
        REQUIRE_REAUTH: value.REQUIRE_REAUTH ?? production,
        ENABLE_SOPS: value.ENABLE_SOPS ?? false,
        /** Cookies are Secure whenever the public URL is https. */
        COOKIE_SECURE: value.APP_URL.startsWith("https://"),
      };
    });

export type Env = z.output<ReturnType<typeof makeSchema>>;

/**
 * `next build` imports server modules with NODE_ENV=production on a machine that has none of the
 * runtime secrets. The production-only requirements are therefore skipped during the build phase
 * and enforced the moment the server starts.
 */
const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

export function parseEnv(
  source: Record<string, string | undefined>,
  options: { building?: boolean } = {}
): Env {
  const result = makeSchema(options.building ?? false).safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env, { building: isBuildPhase() });
  return cached;
}
