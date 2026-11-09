"use client";

import { useCallback, useState } from "react";
import { useApiError, useNetworkError, type ApiErrorBody } from "@/lib/api-error";
import type { ApiResult } from "@/lib/client-api";

/**
 * Pending and error state for one user action that sends a request (a form submit, a confirmed
 * menu action). `run` resolves with the result so the caller decides what success does; a failure
 * is turned into a sentence in the user's language and kept in `error`. Nothing navigates here.
 */
export function useRequestAction() {
  const describe = useApiError();
  const networkMessage = useNetworkError();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorBody, setErrorBody] = useState<ApiErrorBody | null>(null);

  const run = useCallback(
    async <T>(request: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      setPending(true);
      setError(null);
      setErrorBody(null);
      const result = await request();
      setPending(false);
      if (!result.ok) {
        setError(result.network ? networkMessage : describe(result.error));
        setErrorBody(result.error);
      }
      return result;
    },
    [describe, networkMessage]
  );

  const reset = useCallback(() => {
    setError(null);
    setErrorBody(null);
  }, []);

  return { run, pending, error, errorBody, reset };
}
