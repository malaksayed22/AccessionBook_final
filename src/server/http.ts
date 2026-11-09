import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Logger } from "pino";
import type { z } from "zod";
import { getSession, type SessionUser } from "@/lib/auth";
import { canReadCompliance, refusedAsReadOnly } from "@/lib/roles";
import type { RequestMeta } from "./audit";
import { clientIp } from "./client-ip";
import { env } from "./env";
import { AppError, errors, isRuleDetails, toAppError } from "./errors";
import { logger } from "./logger";
import { isRecentlyConfirmed, type ResolvedSession } from "./session";

/** `compliance`: the regulatory reports and audit trail (admins, quality assurance, inspectors). */
type AuthMode = "public" | "user" | "admin" | "compliance";

export type ApiContext<Params, Auth extends AuthMode> = {
  request: Request;
  params: Params;
  user: Auth extends "public" ? SessionUser | null : SessionUser;
  /** The session behind the request (any state); null for anonymous callers. */
  session: ResolvedSession | null;
  /** Throws REAUTH_REQUIRED unless the user confirmed their password recently. */
  requireRecentAuth(): void;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  /** What the audit trail records about where a request came from. */
  meta: RequestMeta;
  log: Logger;
  /** Parses the JSON body against a schema. Malformed or invalid input becomes a 400. */
  json<S extends z.ZodType>(schema: S): Promise<z.infer<S>>;
};

type Options<Auth extends AuthMode> = {
  auth: Auth;
  /**
   * Accept a session whose second factor is still pending or not yet set up. Only the sign-in and
   * MFA endpoints set this; everything else needs a fully active session.
   */
  allowIncompleteSession?: boolean;
  /** Hard cap on the request body, in bytes. */
  maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * State-changing requests from a browser must come from this application. SameSite cookies are the
 * first defence; this is the second. Non-browser clients send no Origin header and are unaffected.
 */
function assertSameOrigin(request: Request) {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw errors.forbidden("Cross-origin request refused");
  }
  const allowedOrigin = new URL(env().APP_URL).origin;
  const host = request.headers.get("host");
  if (parsed.origin !== allowedOrigin && parsed.host !== host) {
    throw errors.forbidden("Cross-origin request refused");
  }
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw errors.validation("The request is too large");
  const text = await request.text();
  if (text.length > maxBytes) throw errors.validation("The request is too large");
  if (!text.trim()) throw errors.validation("A JSON body is required");
  try {
    return JSON.parse(text);
  } catch {
    throw errors.validation("The request body is not valid JSON");
  }
}

/** The parts of a schema issue the UI uses to name the field and the problem; never the input. */
function publicIssue(issue: unknown) {
  const { path, code, origin, minimum, maximum } = (issue ?? {}) as Record<string, unknown>;
  return {
    path: Array.isArray(path)
      ? path.filter((p) => typeof p === "string" || typeof p === "number")
      : [],
    code: typeof code === "string" ? code : "custom",
    ...(typeof origin === "string" ? { origin } : {}),
    ...(typeof minimum === "number" || typeof minimum === "bigint"
      ? { minimum: Number(minimum) }
      : {}),
    ...(typeof maximum === "number" || typeof maximum === "bigint"
      ? { maximum: Number(maximum) }
      : {}),
  };
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Wraps a route handler with everything every endpoint needs, so none can forget it: a request id,
 * authentication and the admin gate, the origin check, bounded JSON parsing with schema validation,
 * and uniform error responses that never leak internals.
 *
 * Handlers return a plain object (sent as JSON), a Response, or nothing (`{ ok: true }`).
 */
export function withApi<Params = Record<string, never>, Auth extends AuthMode = "user">(
  options: Options<Auth>,
  handler: (ctx: ApiContext<Params, Auth>) => Promise<Response | object | void>
) {
  return async (request: Request, route?: { params: Promise<Params> }): Promise<Response> => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    const log = logger.child({
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
    });

    try {
      assertSameOrigin(request);

      const session = await getSession();
      if (options.auth !== "public" && !session) throw errors.unauthenticated();
      if (session && !options.allowIncompleteSession && options.auth !== "public") {
        if (session.state === "mfa-required") throw errors.mfaRequired();
        if (session.state === "mfa-enrolment-required") throw errors.mfaEnrolmentRequired();
      }
      // Public endpoints only see a user when the session is fully active.
      const sessionUser: SessionUser | null =
        session && (session.state === "active" || options.allowIncompleteSession)
          ? { id: session.user.id, name: session.user.name, permissions: session.user.permissions }
          : null;
      if (options.auth === "admin" && sessionUser?.permissions !== "ADMIN")
        throw errors.forbidden();
      if (options.auth === "compliance" && !(sessionUser && canReadCompliance(sessionUser)))
        throw errors.forbidden();
      // An inspector reads; the only thing they change is their own sign-in (password, second
      // factor, sessions). Enforced here for every route, whatever the service would allow.
      if (
        sessionUser &&
        refusedAsReadOnly(sessionUser, request.method, new URL(request.url).pathname)
      ) {
        throw errors.forbidden("Inspector access is read-only");
      }

      const params = (route ? await route.params : {}) as Params;
      const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

      const result = await handler({
        request,
        params,
        user: sessionUser as ApiContext<Params, Auth>["user"],
        session,
        requireRecentAuth() {
          if (!session || !isRecentlyConfirmed(session)) throw errors.reauthRequired();
        },
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        meta: {
          requestId,
          ip: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
        },
        log,
        async json(schema) {
          const parsed = schema.safeParse(await readJson(request, maxBytes));
          if (!parsed.success) {
            throw errors.validation(firstIssue(parsed.error), parsed.error.issues);
          }
          return parsed.data;
        },
      });

      const response =
        result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Request-Id", requestId);
      return response;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === "INTERNAL") {
        log.error({ err: error }, "unhandled error in route handler");
      } else if (appError.status >= 500 || appError.code === "FORBIDDEN") {
        log.warn({ code: appError.code }, appError.message);
      }
      return NextResponse.json(
        {
          ok: false,
          // `error` stays a plain string: existing client code reads `data.error`.
          error: appError.message,
          code: appError.code,
          requestId,
          // Schema failures list their issues, so the form can name the field.
          ...(appError.code === "VALIDATION" && Array.isArray(appError.details)
            ? { issues: appError.details.map(publicIssue) }
            : {}),
          // Values the UI needs to phrase the message in its own language.
          ...(appError.code === "PASSWORD_POLICY" ||
          appError.code === "RATE_LIMITED" ||
          appError.code === "LOCATION_NOT_EMPTY" ||
          isRuleDetails(appError.details)
            ? { params: appError.details }
            : {}),
          // A bulk action names the unit that stopped it.
          ...(typeof appError.details === "object" &&
          appError.details !== null &&
          "bulkUnit" in appError.details
            ? { bulkUnit: (appError.details as { bulkUnit: unknown }).bulkUnit }
            : {}),
          // A conflict may point at the record it collided with (e.g. an existing organization).
          ...(appError.code === "CONFLICT" &&
          typeof appError.details === "object" &&
          appError.details !== null &&
          "id" in appError.details
            ? { id: (appError.details as { id: unknown }).id }
            : {}),
        },
        {
          status: appError.status,
          headers: {
            "Cache-Control": "no-store",
            "X-Request-Id": requestId,
            ...retryAfterHeader(appError),
          },
        }
      );
    }
  };
}

function retryAfterHeader(error: AppError): Record<string, string> {
  const details = error.details as { retryAfterSeconds?: unknown } | undefined;
  return error.code === "RATE_LIMITED" && typeof details?.retryAfterSeconds === "number"
    ? { "Retry-After": String(details.retryAfterSeconds) }
    : {};
}

export { AppError };

/** A positive integer path or query parameter, or a 400. */
export function parseId(value: string | null | undefined, label = "id"): number {
  const id = Number(value);
  if (!value || !Number.isInteger(id) || id <= 0) throw errors.validation(`Invalid ${label}`);
  return id;
}
