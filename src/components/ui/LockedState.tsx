import { Check, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/*
 * Usage:
 *   <LockedState
 *     icon={<Lock />}
 *     title="Reports are locked"
 *     body="A report needs a signed-off protocol first."
 *     checklist={[{ label: "Protocol approved", done: false }, { label: "Lab assigned", done: true }]}
 *     action={{ label: "Open protocol", href: "/protocols" }}
 *   />
 * Replaces a dead-end "not allowed" message: it says what is missing, shows progress, and puts
 * one button on the step that unblocks it. Checklist state is conveyed by icon and spoken text.
 */
export type LockedStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  body: ReactNode;
  checklist?: Array<{ label: string; done: boolean }>;
  action: { label: string; href: string };
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

export function LockedState({
  icon,
  title,
  body,
  checklist,
  action,
  headingLevel = 2,
  className,
}: LockedStateProps) {
  const t = useTranslations("ui");
  const Heading = `h${headingLevel}` as const;

  return (
    <section
      className={cn(
        "mx-auto flex max-w-xl flex-col items-center rounded-xl border border-border bg-surface px-5 py-12 text-center shadow-sm",
        className
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-5 inline-flex size-14 items-center justify-center rounded-full border border-accent-soft-border bg-accent-soft text-accent-text [&>svg]:size-6 [&>svg]:stroke-[1.5]"
        >
          {icon}
        </div>
      ) : null}
      <Heading className="font-serif text-2xl font-normal tracking-[-0.01em] text-balance text-fg">
        {title}
      </Heading>
      <p className="mt-1 max-w-prose text-sm text-pretty text-fg-secondary">{body}</p>

      {checklist?.length ? (
        <ul className="mt-5 flex w-full max-w-sm flex-col gap-2 text-start">
          {checklist.map((item) => (
            <li
              key={item.label}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
                item.done
                  ? "border-success-soft-border bg-success-soft text-success"
                  : "border-border bg-sunken text-fg-secondary"
              )}
            >
              {item.done ? (
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              ) : (
                <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              )}
              <span className="min-w-0 wrap-break-word">{item.label}</span>
              <span className="sr-only">({item.done ? t("locked.done") : t("locked.todo")})</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Button variant="primary" size="lg" href={action.href} className="mt-6">
        {action.label}
      </Button>
    </section>
  );
}
