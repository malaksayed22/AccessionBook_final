import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

/*
 * Usage: <IconButton label="Close" onClick={...}><X /></IconButton>
 * `label` is required: it becomes aria-label and the hover title, because an icon alone is not a
 * name. Square target, 40px by default and 44px on touch screens.
 */
const iconButtonStyles = cva(
  [
    "inline-flex shrink-0 items-center justify-center rounded-lg border",
    "transition-colors duration-150 motion-reduce:transition-none",
    "disabled:cursor-not-allowed disabled:opacity-60",
    focusRing,
  ],
  {
    variants: {
      variant: {
        secondary: "border-border-input bg-surface text-fg hover:bg-hover",
        ghost: "border-transparent bg-transparent text-fg-secondary hover:bg-hover hover:text-fg",
        danger: "border-danger-soft-border bg-danger-soft text-danger hover:border-danger",
      },
      size: {
        sm: "size-9 pointer-coarse:size-11",
        md: "size-10 pointer-coarse:size-11",
        lg: "size-11",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
);

export type IconButtonProps = VariantProps<typeof iconButtonStyles> &
  Omit<ComponentProps<"button">, "aria-label" | "title" | "children"> & {
    /** Accessible name and tooltip. Required. */
    label: string;
    /** The icon, e.g. a lucide-react element. */
    children: ReactNode;
  };

export function IconButton({
  label,
  variant,
  size,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(iconButtonStyles({ variant, size }), className)}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex items-center [&>svg]:size-5">
        {children}
      </span>
    </button>
  );
}
