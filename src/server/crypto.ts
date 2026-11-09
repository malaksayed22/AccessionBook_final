import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

/** SHA-256 hex. Only for high-entropy secrets (session tokens, recovery codes), never passwords. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 256 random bits, URL-safe. The raw value goes to the browser; only its hash is stored. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Development and test fallback only. Production refuses to start without MFA_ENCRYPTION_KEY (see
 * env.ts), so this key can never protect real secrets.
 */
const DEV_KEY = createHash("sha256").update("accession-book-development-only-key").digest();

function encryptionKey(): Buffer {
  const configured = env().MFA_ENCRYPTION_KEY;
  if (!configured) return DEV_KEY;
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}

/** AES-256-GCM; output is `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
