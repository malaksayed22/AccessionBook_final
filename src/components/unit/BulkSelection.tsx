"use client";

import { Check, Download, Minus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { BulkAction, BulkUnit } from "@/lib/unit-bulk";
import { BULK_ACTIONS, planBulk } from "@/lib/unit-bulk";
import type { Option } from "./action-types";
import { BulkDialog } from "./BulkDialogs";

/*
 * Usage (server page): wrap the table and give its first column a checkbox cell.
 *
 *   <BulkProvider units={rows.map(toBulkUnit)} locations={locations}>
 *     <DataTable columns={[selectColumn, ...columns]} ... />
 *     <BulkBar />
 *   </BulkProvider>
 *
 * The selection lives on the page it was made on: it keeps only units still in the rows shown, so it
 * never carries over to a different page or filter. The bar lists the four bulk actions; each opens a
 * form that says which of the selected units it will touch and which it leaves out, and the server
 * applies it to all of them or to none.
 */
type Selection = {
  units: BulkUnit[];
  selected: ReadonlySet<number>;
  selectedUnits: BulkUnit[];
  toggle: (id: number) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
  locations: Option[];
  canAddLocation: boolean;
  canDestroy: boolean;
  canRelease: boolean;
};
const Context = createContext<Selection | null>(null);

function useSelection(): Selection {
  const value = useContext(Context);
  if (!value) throw new Error("Bulk selection components must be inside a BulkProvider");
  return value;
}

export function BulkProvider({
  units,
  locations,
  canAddLocation = false,
  canDestroy = false,
  canRelease = false,
  children,
}: {
  units: BulkUnit[];
  locations: Option[];
  /** Administrators can add a location from the move form. */
  canAddLocation?: boolean;
  /** Administrators, inventory managers and members of the experiment record a destruction. */
  canDestroy?: boolean;
  /** Releasing a hold: administrators and quality assurance. */
  canRelease?: boolean;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const shown = useMemo(() => new Set(units.map((u) => u.id)), [units]);
  const selected = useMemo(
    () => new Set([...chosen].filter((id) => shown.has(id))),
    [chosen, shown]
  );
  const selectedUnits = useMemo(() => units.filter((u) => selected.has(u.id)), [units, selected]);

  const toggle = useCallback(
    (id: number) =>
      setChosen((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    []
  );
  const setAll = useCallback(
    (on: boolean) => setChosen(on ? new Set(units.map((u) => u.id)) : new Set()),
    [units]
  );
  const clear = useCallback(() => setChosen(new Set()), []);

  const value = useMemo(
    () => ({
      units,
      selected,
      selectedUnits,
      toggle,
      setAll,
      clear,
      locations,
      canAddLocation,
      canDestroy,
      canRelease,
    }),
    [
      units,
      selected,
      selectedUnits,
      toggle,
      setAll,
      clear,
      locations,
      canAddLocation,
      canDestroy,
      canRelease,
    ]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const boxClass =
  "peer size-5 cursor-pointer appearance-none rounded-md border border-border-input bg-surface p-0 checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function Box({
  label,
  checked,
  indeterminate = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex size-5 align-middle">
      <input
        ref={(node) => {
          ref.current = node;
          if (node) node.indeterminate = indeterminate;
        }}
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={boxClass}
      />
      {indeterminate ? (
        <Minus
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3.5 text-on-accent"
        />
      ) : (
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3.5 text-on-accent opacity-0 peer-checked:opacity-100"
        />
      )}
    </span>
  );
}

/** The checkbox in a row. */
export function RowSelect({ id, name }: { id: number; name: string }) {
  const t = useTranslations("units.bulk");
  const { selected, toggle } = useSelection();
  return (
    <Box label={t("selectOne", { name })} checked={selected.has(id)} onChange={() => toggle(id)} />
  );
}

/** The checkbox in the header: selects every row on the page. */
export function SelectAll() {
  const t = useTranslations("units.bulk");
  const { units, selected, setAll } = useSelection();
  const all = units.length > 0 && selected.size === units.length;
  return (
    <Box
      label={t("selectAll")}
      checked={all}
      indeterminate={selected.size > 0 && !all}
      onChange={setAll}
    />
  );
}

/** Appears once something is selected; stays in view at the foot of the page. */
export function BulkBar() {
  const t = useTranslations("units.bulk");
  const { selectedUnits, clear, canDestroy, canRelease } = useSelection();
  const [action, setAction] = useState<BulkAction | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  if (selectedUnits.length === 0 && action === null) return null;

  const close = () => {
    setAction(null);
    const target = opener.current;
    opener.current = null;
    setTimeout(() => target?.isConnected && target.focus(), 0);
  };

  return (
    <>
      {selectedUnits.length > 0 ? (
        <div
          role="region"
          aria-label={t("barLabel")}
          className={cn(
            "sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border-strong bg-raised py-3 ps-4 pe-4 shadow-lg lg:pe-44"
          )}
        >
          <p className="me-auto text-sm font-medium text-fg" aria-live="polite">
            {t("selected", { count: selectedUnits.length })}
          </p>
          {BULK_ACTIONS.filter(
            // Destruction is for those who edit the units; releasing a hold is a quality decision.
            (id) => (id !== "destroy" || canDestroy) && (id !== "release" || canRelease)
          ).map((id) => {
            const applicable = planBulk(id, selectedUnits).eligible.length;
            return (
              <Button
                key={id}
                size="sm"
                variant={id === "destroy" ? "danger" : "secondary"}
                disabled={applicable === 0}
                title={applicable === 0 ? t("noneCan") : undefined}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setAction(id);
                }}
              >
                {t(`actions.${id}`)}
              </Button>
            );
          })}
          {/* A file from an API route: a plain link, with no language prefix. */}
          <a
            href={`/api/units/export?ids=${selectedUnits.map((u) => u.id).join(",")}`}
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            <Download aria-hidden="true" className="size-4" />
            {t("export")}
          </a>
          <Button size="sm" variant="ghost" icon={<X />} onClick={clear}>
            {t("clear")}
          </Button>
        </div>
      ) : null}
      {action ? <BulkDialog action={action} onClose={close} /> : null}
    </>
  );
}

export { useSelection };
