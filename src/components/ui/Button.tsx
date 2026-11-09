import { cva, type VariantProps } from "class-variance-authority";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";
import { focusRing } from "./styles";

/*
 * Usage:
 *   <Button variant="primary" type="submit" loading={pending}>Save</Button>
 *   <Button href="/inventory/units" variant="secondary">All units</Button>      // renders the i18n <Link>
 *   <Button variant="danger" icon={<Trash2 />}>Void record</Button>
 *
 * Works in server and client components (no "use client"). Native buttons default to
 * type="button" so they never submit a form by accident. `loading` disables the button, sets
 * aria-busy and adds spoken "Loading…" text.
 */
export const buttonStyles = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-lg border text-center font-medium",
    "transition-[color,background-color,border-color,transform] duration-150 motion-reduce:transition-none",
    "enabled:active:scale-[0.98] aria-disabled:active:scale-100 motion-reduce:active:scale-100",
    "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    focusRing,
  ],
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-accent text-on-accent shadow-[0_1px_2px_color-mix(in_srgb,var(--color-accent)_45%,transparent),0_8px_18px_-8px_color-mix(in_srgb,var(--color-accent)_60%,transparent)] hover:bg-accent-hover",
        secondary:
          "border-border-input bg-surface text-fg shadow-xs hover:border-accent-text hover:bg-accent-soft hover:text-accent-text",
        ghost: "border-transparent bg-transparent text-fg-secondary hover:bg-hover hover:text-fg",
        // A solid red fill has no verified text pairing in the tokens, so danger is a strong tint.
        danger:
          "border-danger-soft-border bg-danger-soft font-semibold text-danger hover:border-danger",
      },
      size: {
        sm: "min-h-9 px-3.5 py-1.5 text-sm pointer-coarse:min-h-11",
        md: "min-h-10 px-5 py-2 text-sm pointer-coarse:min-h-11",
        lg: "min-h-12 px-7 py-3 text-base",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

type SharedProps = VariantProps<typeof buttonStyles> & {
  /** Decorative icon before the label (an <svg>, hidden from assistive technology). */
  icon?: ReactNode;
  /** Decorative icon after the label. */
  iconAfter?: ReactNode;
};

type NativeButtonProps = SharedProps &
  Omit<ComponentProps<"button">, "href"> & {
    href?: undefined;
    /** Disables the button, sets aria-busy and shows a spinner with spoken text. */
    loading?: boolean;
  };

type LinkButtonProps = SharedProps &
  Omit<ComponentProps<"a">, "href"> & {
    href: string;
    loading?: undefined;
  };

export type ButtonProps = NativeButtonProps | LinkButtonProps;

const decorative = (node: ReactNode) =>
  node ? (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center [&>svg]:size-4">
      {node}
    </span>
  ) : null;

export function Button(props: ButtonProps) {
  const t = useTranslations("ui");

  if (props.href !== undefined) {
    const { variant, size, icon, iconAfter, className, children, href, ...rest } = props;
    return (
      <Link href={href} className={cn(buttonStyles({ variant, size }), className)} {...rest}>
        {decorative(icon)}
        {children}
        {decorative(iconAfter)}
      </Link>
    );
  }

  const {
    variant,
    size,
    icon,
    iconAfter,
    className,
    children,
    loading = false,
    disabled,
    type = "button",
    ...rest
  } = props;

  return (
    <button
      type={type}
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner />
          <span className="sr-only">{t("loading")}</span>
        </>
      ) : (
        decorative(icon)
      )}
      {children}
      {loading ? null : decorative(iconAfter)}
    </button>
  );
}
