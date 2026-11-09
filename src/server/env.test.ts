import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const DATABASE_URL = "postgresql://u:p@db:5432/app";

describe("parseEnv", () => {
  it("applies safe defaults for everything except the database", () => {
    const env = parseEnv({ DATABASE_URL });
    expect(env.NODE_ENV).toBe("development");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("accepts a valid configuration", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      APP_URL: "https://app.accessionbook.com",
      LOG_LEVEL: "warn",
      DATABASE_URL: "postgres://u:p@db:5432/app",
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    });
    expect(env.NODE_ENV).toBe("production");
    // Two-step verification is optional by default, even in production.
    expect(env.REQUIRE_ADMIN_MFA).toBe(false);
    expect(env.REQUIRE_REAUTH).toBe(true);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.LOG_LEVEL).toBe("warn");
  });

  it("refuses to start without a database URL (there is deliberately no default)", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it.each(["", "file:./dev.db", "mysql://u:p@h/db", "localhost:5432"])(
    "rejects DATABASE_URL %j",
    (value) => {
      expect(() => parseEnv({ DATABASE_URL: value })).toThrowError(/DATABASE_URL/);
    }
  );

  it("fails fast and names every invalid variable", () => {
    expect(() => parseEnv({ DATABASE_URL, APP_URL: "not a url", LOG_LEVEL: "loud" })).toThrowError(
      /APP_URL[\s\S]*LOG_LEVEL|LOG_LEVEL[\s\S]*APP_URL/
    );
  });

  it("turns the security guards on by default only in production, and lets them be overridden", () => {
    const dev = parseEnv({ DATABASE_URL });
    expect(dev).toMatchObject({
      REQUIRE_ADMIN_MFA: false,
      REQUIRE_REAUTH: false,
      COOKIE_SECURE: false,
    });
    expect(parseEnv({ DATABASE_URL, REQUIRE_ADMIN_MFA: "true" }).REQUIRE_ADMIN_MFA).toBe(true);
    // Procedures are a module the lab switches on when it adopts them.
    expect(dev.ENABLE_SOPS).toBe(false);
    expect(parseEnv({ DATABASE_URL, ENABLE_SOPS: "true" }).ENABLE_SOPS).toBe(true);
  });

  it("refuses an insecure production configuration", () => {
    expect(() =>
      parseEnv({ DATABASE_URL, NODE_ENV: "production", APP_URL: "http://app.example.com" })
    ).toThrowError(/MFA_ENCRYPTION_KEY[\s\S]*APP_URL|APP_URL[\s\S]*MFA_ENCRYPTION_KEY/);
  });

  it("builds without the runtime secrets, and still refuses a bad database URL", () => {
    // A container image is built with no secrets at all; the server checks them when it starts.
    const built = parseEnv({ NODE_ENV: "production" }, { building: true });
    expect(built.DATABASE_URL).toMatch(/^postgresql:\/\//);
    expect(() =>
      parseEnv({ NODE_ENV: "production", DATABASE_URL: "mysql://x" }, { building: true })
    ).toThrowError(/DATABASE_URL/);
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrowError(/DATABASE_URL/);
  });

  it("requires a bucket when files are stored in S3", () => {
    expect(() => parseEnv({ DATABASE_URL, STORAGE_DRIVER: "s3" })).toThrowError(/S3_BUCKET/);
    expect(parseEnv({ DATABASE_URL, STORAGE_DRIVER: "s3", S3_BUCKET: "b" }).S3_REGION).toBe(
      "ca-central-1"
    );
  });
});
