"use client";

import { useCallback, useState } from "react";

/**
 * Typed state for a form of string fields. `set` updates one field; the value type is checked per
 * key, so `set("quantity", 3)` is a compile error (inputs always hold strings).
 */
export function useFormValues<V extends Record<string, string | boolean>>(initial: () => V) {
  const [values, setValues] = useState<V>(initial);
  const set = useCallback(
    <K extends keyof V>(key: K, value: V[K]) =>
      setValues((current) => ({ ...current, [key]: value })),
    []
  );
  return [values, set] as const;
}
