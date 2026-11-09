"use client";

import { CircleCheck, Info, OctagonAlert, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";
import { softTone } from "./styles";

/*
 * Usage:
 *   <Banner tone="warning" title="Hold in effect">Release requires QA sign-off.</Banner>
 *   <Banner tone="info" dismissible onDismiss={() => ...}>...</Banner>
 *
 * Warning and danger banners use role="alert" (assertive); info and success use role="status"
 * (polite). Each tone has its own icon and a spoken tone name, so colour is never the only cue.
 * Client component because it can be dismissed.
 */
export type BannerTone = "info" | "success" | "warning" | "danger";

const TONE_ICON: Record<BannerTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
};

export type BannerProps = {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
};

export function Banner({
  tone = "info",
  title,
  children,
  dismissible = false,
  onDismiss,
  className,
}: BannerProps) {
  const t = useTranslations("ui");
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // An error that appears where the reader cannot see it (the top of a long form, after pressing
  // the button at the bottom) is brought into view. A banner already on screen stays put.
  useEffect(() => {
    const element = ref.current;
    if (tone !== "danger" || !element) return;
    const box = element.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [tone]);

  if (dismissed) return null;

  const Icon = TONE_ICON[tone];
  const urgent = tone === "danger" || tone === "warning";

  return (
    <div
      ref={ref}
      role={urgent ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 sm:p-4",
        softTone[tone],
        className
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="sr-only">{t(`tone.${tone}`)}: </span>
        {title ? <p className="font-semibold wrap-break-word">{title}</p> : null}
        {children ? (
          <div className={cn("wrap-break-word text-fg", title && "mt-0.5")}>{children}</div>
        ) : null}
      </div>
      {dismissible ? (
        <IconButton
          label={t("dismiss")}
          size="sm"
          className="-m-1 text-current"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          <X />
        </IconButton>
      ) : null}
    </div>
  );
}
