import "server-only";
import pino from "pino";
import { env } from "./env";

/**
 * Structured JSON logs to stdout (collected by CloudWatch in production).
 * Credentials and personal data are redacted at the logger, so a careless
 * `logger.info({ user })` cannot leak them.
 */
const REDACTED_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "token",
  "inviteToken",
  "authorization",
  "cookie",
  "set-cookie",
  "email",
];

export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: "accession-book" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      ...REDACTED_KEYS,
      ...REDACTED_KEYS.map((key) => `*.${key}`),
      ...REDACTED_KEYS.map((key) => `req.headers["${key}"]`),
    ],
    censor: "[redacted]",
  },
});

export function requestLogger(requestId: string) {
  return logger.child({ requestId });
}
