import { HiddenParams } from "@/components/page/SearchForm";
import { LiveForm } from "@/components/page/LiveForm";
import { SearchField } from "@/components/page/SearchField";
import { Input } from "@/components/ui/FormControls";
import { toolbarLabel } from "@/components/ui/styles";

/*
 * Usage (server component):
 *   <RegisterSearchForm action="/inventory/destroyed" params={{ type, sort, order }} q={q} from={from} to={to}
 *     label="Search the register" placeholder="Unit, reason, person" fromLabel="From" toLabel="To" />
 * Live search for registers that are also bounded by dates: the list narrows as people type or pick
 * a date (see LiveForm), with no button. The other list parameters ride along as hidden fields and
 * the page number resets. `action` is a locale-less path.
 */
export type RegisterSearchFormProps = {
  action: string;
  params: Record<string, string | number | undefined | null>;
  q?: string;
  from?: string;
  to?: string;
  label: string;
  placeholder?: string;
  fromLabel: string;
  toLabel: string;
};

export function RegisterSearchForm({
  action,
  params,
  q,
  from,
  to,
  label,
  placeholder,
  fromLabel,
  toLabel,
}: RegisterSearchFormProps) {
  const id = `search-${action.replace(/\W+/g, "-")}`;
  return (
    <LiveForm
      action={action}
      role="search"
      aria-label={label}
      className="flex flex-wrap items-end gap-x-8 gap-y-4"
    >
      <HiddenParams params={params} skip={["q", "page", "from", "to"]} />
      <div className="min-w-64 flex-1">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <SearchField id={id} name="q" defaultValue={q} placeholder={placeholder} />
      </div>
      <div>
        <label htmlFor={`${id}-from`} className={toolbarLabel}>
          {fromLabel}
        </label>
        <Input id={`${id}-from`} variant="line" name="from" type="date" defaultValue={from} />
      </div>
      <div>
        <label htmlFor={`${id}-to`} className={toolbarLabel}>
          {toLabel}
        </label>
        <Input id={`${id}-to`} variant="line" name="to" type="date" defaultValue={to} />
      </div>
    </LiveForm>
  );
}
