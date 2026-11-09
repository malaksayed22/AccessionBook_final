"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/FormControls";
import { toolbarLabel } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";

/*
 * Usage: <SelectFilter label="Location" value={locationId ?? "all"} options={[{ value: "all", label: "All locations", href: "/inventory/units" }, ...]} />
 * A labelled native select, drawn as a hairline like the search box, that navigates when changed.
 * The URL is the state, so it can be shared and the back button works. (A select cannot be a plain
 * link, which is why this one is a client component.)
 */
export type SelectFilterProps = {
  label: string;
  value: string;
  /** Each option carries its destination URL: functions cannot cross from server to client. */
  options: Array<{ value: string; label: string; href: string }>;
  className?: string;
};

export function SelectFilter({ label, value, options, className }: SelectFilterProps) {
  const router = useRouter();
  const id = useId();
  return (
    <div className={cn("min-w-44", className)}>
      <label htmlFor={id} className={toolbarLabel}>
        {label}
      </label>
      <Select
        id={id}
        variant="line"
        value={value}
        onChange={(event) => {
          const target = options.find((option) => option.value === event.target.value);
          // A filter changes the list in place: the page keeps its scroll position.
          if (target) router.push(target.href, { scroll: false });
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
