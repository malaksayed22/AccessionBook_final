"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FormEvent, ReactNode } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import type { ActionId } from "@/lib/action-catalog";
import { ACTION_ICONS } from "./icons";

type FormFrameProps = {
  action: ActionId;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Translated error from the last request; shown above the fields. */
  error?: string | null;
  /** Extra line under the description, e.g. "Step 1 of 2". */
  progress?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

/**
 * The common shape of every action form: a way back to the menu, what the action is, the last
 * error, the fields and the buttons. Heading level 3 sits under the dialog title.
 */
export function FormFrame({
  action,
  onBack,
  onSubmit,
  error,
  progress,
  children,
  footer,
}: FormFrameProps) {
  const t = useTranslations("actions");
  const Icon = ACTION_ICONS[action];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack} className="-ms-2">
          {t("launcher.back")}
        </Button>
      </div>

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="font-serif text-2xl leading-7 font-normal tracking-[-0.01em] wrap-break-word">
            {t(`items.${action}.title`)}
          </h3>
          <p className="text-sm text-fg-secondary">{t(`items.${action}.description`)}</p>
          {progress ? <p className="mt-1 text-sm font-medium text-fg">{progress}</p> : null}
        </div>
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {children}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {footer}
        </div>
      </form>
    </div>
  );
}

type SubmitButtonProps = {
  label: string;
  pending: boolean;
  variant?: "primary" | "danger";
  disabled?: boolean;
};

/** Always a submit button: the form's handler decides whether that means "next step" or "send". */
export function SubmitButton({ label, pending, variant = "primary", disabled }: SubmitButtonProps) {
  return (
    <Button type="submit" variant={variant} loading={pending} disabled={disabled}>
      {label}
    </Button>
  );
}
