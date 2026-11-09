"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActionBootstrap } from "@/features/action/types";
import type { ApiErrorBody } from "@/lib/api-error";

export type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; data: ActionBootstrap }
  | { status: "failed"; network: boolean; body: ApiErrorBody | null };

async function load(unitId: number | undefined, signal: AbortSignal): Promise<BootstrapState> {
  const url = unitId ? `/api/actions/bootstrap?unitId=${unitId}` : "/api/actions/bootstrap";
  try {
    const response = await fetch(url, { signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) return { status: "failed", network: false, body };
    return { status: "ready", data: body as ActionBootstrap };
  } catch {
    return { status: "failed", network: true, body: null };
  }
}

/**
 * Loads the picker data once when the launcher opens, and again on demand (after an action, because
 * a unit's status decides which actions are offered). The request is cancelled if the dialog closes.
 */
export function useActionBootstrap(unitId?: number) {
  const [state, setState] = useState<BootstrapState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void load(unitId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, [unitId, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, reload };
}
