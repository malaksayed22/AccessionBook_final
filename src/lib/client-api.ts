import type { ApiErrorBody } from "./api-error";

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; error: ApiErrorBody | null; network: boolean };

/**
 * Registered by `ReauthProvider`. Called when the server answers REAUTH_REQUIRED: it asks the user
 * for their password and resolves true once the session is freshly confirmed, so the request that
 * was refused can be sent again transparently.
 */
type ReauthHandler = () => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;

export function setReauthHandler(handler: ReauthHandler | null) {
  reauthHandler = handler;
}

async function once<T>(url: string, body: unknown, method: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: null, network: true };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data as ApiErrorBody | null, network: false };
  return { ok: true, data: data as T };
}

/**
 * Sends JSON and returns a typed result instead of throwing, so forms handle three outcomes the
 * same way: success, a server answer that says no (with a code to translate), or no answer at all.
 * A sensitive action that needs a fresh password prompts for it once and retries.
 */
export async function sendJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST"
): Promise<ApiResult<T>> {
  const first = await once<T>(url, body, method);
  if (!first.ok && first.error?.code === "REAUTH_REQUIRED" && reauthHandler) {
    if (await reauthHandler()) return once<T>(url, body, method);
  }
  return first;
}
