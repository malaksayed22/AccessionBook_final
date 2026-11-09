"use client";

import { ChevronsUpDown } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { FieldControlProps } from "./Field";
import { Input } from "./FormControls";
import { cn } from "@/lib/utils";

/*
 * Usage (inside a Field, so it is labelled):
 *   <Field label="Sub-experiment of">
 *     {(control) => (
 *       <SearchableSelect
 *         {...control}
 *         value={id}
 *         onChange={setId}
 *         noneLabel="None: this is a new experiment"
 *         noResultsLabel="No experiment matches"
 *         countLabel={(n) => `${n} results`}
 *         options={[{ value: "4", label: "EXP4 — Terpene study" }]}
 *       />
 *     )}
 *   </Field>
 * A drop-down list you can also type into: the list narrows to the options containing what was typed,
 * in their label (a code or a name). It follows the ARIA combobox pattern: the arrow keys move through
 * the list, Enter picks, Escape closes, and a screen reader hears how many options match. The first
 * option is always "none" (value ""), so a choice can be cleared.
 */
export type SearchableOption = { value: string; label: string };

type Props = Partial<FieldControlProps> & {
  value: string;
  options: ReadonlyArray<SearchableOption>;
  onChange: (value: string) => void;
  /** Label of the empty choice (value ""). */
  noneLabel: string;
  noResultsLabel: string;
  /** Announced to screen readers while the list is narrowed: "3 results". */
  countLabel: (count: number) => string;
  placeholder?: string;
  name?: string;
  /** Called with what is typed, so the options can be fetched as the person types. */
  onQueryChange?: (query: string) => void;
  /** The options already answer the typed text (they come from a search): do not narrow them again. */
  remote?: boolean;
};

const normalize = (text: string) =>
  text.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function SearchableSelect({
  value,
  options,
  onChange,
  noneLabel,
  noResultsLabel,
  countLabel,
  placeholder,
  name,
  onQueryChange,
  remote = false,
  ...control
}: Props) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value);
  const needle = normalize(query.trim());
  const shown = useMemo(() => {
    const matches =
      needle && !remote
        ? options.filter((option) => normalize(option.label).includes(needle))
        : options;
    return [{ value: "", label: noneLabel }, ...matches];
  }, [needle, options, noneLabel, remote]);
  const matchCount = shown.length - 1;

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
    onQueryChange?.("");
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    onQueryChange?.("");
  };

  const move = (delta: number) => {
    setOpen(true);
    setActive((index) => (index + delta + shown.length) % shown.length);
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter":
        // Never submit the form that contains the picker.
        event.preventDefault();
        if (open) choose(shown[active]?.value ?? "");
        else setOpen(true);
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        break;
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className="relative">
      <Input
        ref={input}
        {...control}
        name={name}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? optionId(active) : undefined}
        autoComplete="off"
        value={open ? query : (selected?.label ?? "")}
        placeholder={open ? (selected?.label ?? noneLabel) : (placeholder ?? noneLabel)}
        className="pe-9"
        onChange={(event) => {
          setQuery(event.target.value);
          onQueryChange?.(event.target.value);
          setActive(event.target.value.trim() ? 1 : 0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setActive(
            Math.max(
              0,
              shown.findIndex((option) => option.value === value)
            )
          );
        }}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      <ChevronsUpDown
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-tertiary"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border-strong bg-raised py-1 shadow-lg"
        >
          {shown.map((option, index) => (
            <li
              key={option.value || "none"}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              // Keep focus in the input: a click must pick the option before the blur closes the list.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm wrap-break-word text-fg",
                index === active && "bg-hover",
                option.value === value && "font-medium text-accent-text",
                option.value === "" && "text-fg-secondary"
              )}
            >
              {option.label}
            </li>
          ))}
          {matchCount === 0 ? (
            <li role="presentation" className="px-3 py-2 text-sm text-fg-secondary">
              {noResultsLabel}
            </li>
          ) : null}
        </ul>
      ) : null}
      <span role="status" className="sr-only">
        {open && needle ? countLabel(matchCount) : ""}
      </span>
    </div>
  );
}
