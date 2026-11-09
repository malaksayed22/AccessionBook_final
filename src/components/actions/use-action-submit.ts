"use client";

import { useCallback, useState } from "react";
import { useApiError, useNetworkError } from "@/lib/api-error";
import type { ApiResult } from "@/lib/client-api";
import { useRouter } from "@/i18n/navigation";

/**
 * Runs one request for an action form: pending state, the dialog's busy flag, a translated error
 * for either kind of failure (the server said no, or never answered) and a refresh of the page
 * behind the dialog on success. It never navigates and returns null on failure, so a failed request
 * cannot lead to a success screen.
 */
export function useActionSubmit(onBusyChange: (busy: boolean) => void) {
  const router = useRouter();
  const apiError = useApiError();
  const networkError = useNetworkError();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(request: () => Promise<ApiResult<T>>): Promise<T | null> => {
      setPending(true);
      onBusyChange(true);
      setError(null);
      const result = await request();
      setPending(false);
      onBusyChange(false);
      if (result.ok) {
        router.refresh();
        return result.data;
      }
      setError(result.network ? networkError : apiError(result.error));
      return null;
    },
    [apiError, networkError, onBusyChange, router]
  );

  return { pending, error, setError, run };
}

/** multipart upload (the attachments route takes a form, so it cannot go through `sendJson`). */
export async function sendForm<T = Record<string, unknown>>(
  url: string,
  body: FormData
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body });
  } catch {
    return { ok: false, error: null, network: true };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data, network: false };
  return { ok: true, data: data as T };
}
