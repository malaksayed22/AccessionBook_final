import { LiveForm } from "./LiveForm";
import { SearchField } from "./SearchField";

/*
 * Usage (server component):
 *   <SearchForm action="/inventory/units" params={{ status, sort, order }} q={q} label="Search units" placeholder="Name, cultivar…" />
 * Live search: the list narrows as people type (see LiveForm), with no button. The other list
 * parameters ride along as hidden fields and the page number resets. `action` is a locale-less path.
 */
export type SearchFormProps = {
  action: string;
  params: Record<string, string | number | undefined | null>;
  q?: string;
  label: string;
  placeholder?: string;
  className?: string;
};

export function SearchForm({ action, params, q, label, placeholder, className }: SearchFormProps) {
  const id = `search-${action.replace(/\W+/g, "-")}`;
  return (
    <LiveForm action={action} role="search" aria-label={label} className={className}>
      <HiddenParams params={params} skip={["q", "page"]} />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchField id={id} name="q" defaultValue={q} placeholder={placeholder} />
    </LiveForm>
  );
}

/** The list parameters that are not edited here, kept in the URL as hidden fields. */
export function HiddenParams({
  params,
  skip,
}: {
  params: Record<string, string | number | undefined | null>;
  skip: readonly string[];
}) {
  return Object.entries(params).map(([key, value]) =>
    value === undefined || value === null || value === "" || skip.includes(key) ? null : (
      <input key={key} type="hidden" name={key} value={String(value)} />
    )
  );
}
