"use client";

import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useEffect, useRef, useTransition, type ComponentProps, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/*
 * Usage (inside a server component):
 *   <LiveForm action="/inventory/units" role="search" aria-label="Search units">
 *     <input type="hidden" name="status" value="hold" />
 *     <SearchField id="units-q" name="q" defaultValue={q} />
 *   </LiveForm>
 *
 * A GET form that applies itself: typing in a text or date field updates the URL after a short pause, and
 * choosing in a select updates it at once, so a list narrows as people type and no
 * "Search" button is needed. The URL stays the state (shareable, back button works) and the page
 * number resets because `page` is never carried over. Without JavaScript it is still an ordinary
 * GET form that submits on Enter. `action` is a locale-less path; the language prefix is added.
 *
 * While the next page loads the form carries `aria-busy`, which children can style with
 * `group-aria-busy/live:`.
 */
const TYPING_DELAY_MS = 250;
// Fields that change a character at a time. A date is half-valid while its year is typed.
const TYPED_TYPES = new Set(["text", "search", "email", "tel", "url", "number", "date"]);

export type LiveFormProps = Omit<ComponentProps<"form">, "action" | "method" | "onSubmit"> & {
  action: string;
};

export function LiveForm({ action, className, children, ...rest }: LiveFormProps) {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const cancelPending = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const navigate = (mode: "push" | "replace") => {
    const form = formRef.current;
    if (!form) return;
    cancelPending();
    const target = buildUrl(action, form);
    startTransition(() => {
      if (mode === "push") router.push(target, { scroll: false });
      else router.replace(target, { scroll: false });
    });
  };

  const handleInput = (event: FormEvent<HTMLFormElement>) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    if (field instanceof HTMLInputElement && TYPED_TYPES.has(field.type)) {
      // Wait for an input method editor (Arabic, Japanese, ...) to finish its composition.
      if ((event.nativeEvent as InputEvent).isComposing) return;
      cancelPending();
      timer.current = window.setTimeout(() => navigate("replace"), TYPING_DELAY_MS);
      return;
    }
    navigate("push");
  };

  // The URL can change without this form (back button, "Clear filters"): show it in the fields.
  // A field being typed in is left alone.
  const query = searchParams.toString();
  useEffect(() => {
    if (formRef.current) syncFields(formRef.current, new URLSearchParams(query));
  }, [query]);

  useEffect(() => {
    const typing = timer;
    return () => window.clearTimeout(typing.current);
  }, []);

  return (
    <form
      ref={formRef}
      action={`/${locale}${action}`}
      method="get"
      aria-busy={pending || undefined}
      className={cn("group/live", className)}
      onInput={handleInput}
      onCompositionEnd={() => {
        cancelPending();
        timer.current = window.setTimeout(() => navigate("replace"), TYPING_DELAY_MS);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        navigate("push");
      }}
      {...rest}
    >
      {children}
    </form>
  );
}

/** `path?name=value&...` for every non-empty named field; `page` is dropped so a new filter starts at page 1. */
function buildUrl(path: string, form: HTMLFormElement): string {
  const params = new URLSearchParams();
  for (const [name, value] of new FormData(form)) {
    if (typeof value !== "string" || name === "page") continue;
    const text = value.trim();
    if (text) params.append(name, text);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function syncFields(form: HTMLFormElement, params: URLSearchParams) {
  for (const element of Array.from(form.elements)) {
    const isField = element instanceof HTMLInputElement || element instanceof HTMLSelectElement;
    if (!isField || !element.name || element.type === "hidden") continue;
    if (element === document.activeElement) continue;
    const next = params.get(element.name) ?? "";
    if (element.value.trim() !== next) element.value = next;
  }
}
