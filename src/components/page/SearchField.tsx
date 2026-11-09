"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, type ComponentProps } from "react";
import { lineControl } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

/*
 * Usage: inside a <LiveForm>, <SearchField id="units-q" name="q" defaultValue={q} placeholder="Name, cultivar…" />
 * A hairline search box: magnifier at the start, a clear button at the end while there is text. The
 * magnifier pulses while the enclosing LiveForm is loading. Give it a visible or `sr-only` <label>.
 */
export type SearchFieldProps = Omit<ComponentProps<"input">, "type">;

export function SearchField({ className, placeholder, ...rest }: SearchFieldProps) {
  const t = useTranslations("common.actions");
  const input = useRef<HTMLInputElement>(null);

  const clear = () => {
    const field = input.current;
    if (!field) return;
    field.value = "";
    // Tells the enclosing LiveForm the text changed.
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  };

  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-0 top-1/2 size-4 -translate-y-1/2 text-fg-tertiary group-aria-busy/live:animate-pulse motion-reduce:animate-none"
      />
      <input
        ref={input}
        type="search"
        autoComplete="off"
        // A blank placeholder lets the clear button hide itself with CSS while the box is empty.
        placeholder={placeholder || " "}
        className={cn(
          lineControl,
          "peer min-h-11 ps-7 pe-9 text-base [&::-webkit-search-cancel-button]:appearance-none",
          className
        )}
        {...rest}
      />
      <button
        type="button"
        onClick={clear}
        aria-label={t("clear")}
        className="absolute end-0 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg peer-placeholder-shown:hidden focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:size-11 motion-reduce:transition-none"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
