"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { UnitTypeBadge } from "@/components/page/domain-badges";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { Spinner } from "@/components/ui/Spinner";
import { useApiError, useNetworkError, type ApiErrorBody } from "@/lib/api-error";

const TYPING_DELAY_MS = 300;

type PickerUnit = { id: number; name: string; type: "PLANT" | "SEEDLOT" | "FLOWER" | "CULTURE" };

/*
 * Usage: <UnitPicker endpoint="/api/qa/units?scope=holdable" label="Unit" onPick={(unit) => ...} />
 * A labelled live search (the list updates as you type; Enter searches at once) that lists matching
 * units from a read-only endpoint answering `{ units: [...] }`. Works inside a form: Enter searches,
 * it never submits. Choosing a unit calls `onPick` with the whole row the endpoint returned.
 */
export function UnitPicker<T extends PickerUnit>({
  endpoint,
  label,
  hint,
  error,
  renderMeta,
  onPick,
}: {
  endpoint: string;
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  renderMeta?: (unit: T) => ReactNode;
  onPick: (unit: T) => void;
}) {
  const t = useTranslations("qa.picker");
  const describe = useApiError();
  const networkMessage = useNetworkError();
  const listId = useId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState<T[] | null>(null);
  const [failure, setFailure] = useState("");
  const typingTimer = useRef<number | undefined>(undefined);
  const latestRequest = useRef(0);

  useEffect(() => {
    const typing = typingTimer;
    return () => window.clearTimeout(typing.current);
  }, []);

  async function search(term: string) {
    window.clearTimeout(typingTimer.current);
    const q = term.trim();
    const request = ++latestRequest.current;
    if (!q) {
      setUnits(null);
      setFailure("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure("");
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const response = await fetch(`${endpoint}${separator}q=${encodeURIComponent(q)}`);
      const body = (await response.json().catch(() => null)) as
        ({ units?: T[] } & ApiErrorBody) | null;
      if (request !== latestRequest.current) return;
      if (!response.ok || !body?.units) {
        setUnits(null);
        setFailure(describe(body));
        return;
      }
      setUnits(body.units);
    } catch {
      if (request !== latestRequest.current) return;
      setUnits(null);
      setFailure(networkMessage);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label={label} hint={hint} error={error || failure}>
        {(control) => (
          <div className="relative">
            <Input
              {...control}
              variant="line"
              type="search"
              value={text}
              placeholder={t("placeholder")}
              autoComplete="off"
              className="pe-8"
              onChange={(event) => {
                const next = event.target.value;
                setText(next);
                window.clearTimeout(typingTimer.current);
                typingTimer.current = window.setTimeout(() => void search(next), TYPING_DELAY_MS);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void search(text);
                }
              }}
            />
            {loading ? (
              <span className="pointer-events-none absolute end-0 top-1/2 -translate-y-1/2">
                <Spinner />
              </span>
            ) : null}
          </div>
        )}
      </Field>

      <div aria-live="polite" id={listId}>
        {units === null ? null : units.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("none")}</p>
        ) : (
          <>
            <p className="sr-only">{t("found", { count: units.length })}</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {units.map((unit) => (
                <li key={unit.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium wrap-break-word">{unit.name}</span>
                    <UnitTypeBadge type={unit.type} linked={false} />
                    {renderMeta ? (
                      <span className="text-fg-secondary">{renderMeta(unit)}</span>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t("choose", { name: unit.name })}
                    onClick={() => {
                      onPick(unit);
                      setUnits(null);
                      setText("");
                    }}
                  >
                    {t("chooseShort")}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
