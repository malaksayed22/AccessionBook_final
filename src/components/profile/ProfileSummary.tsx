import { CircleCheck, CircleDashed } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { initialsOf } from "@/lib/initials";
import type { Role } from "@/lib/roles";

type Props = {
  name: string;
  isAdmin: boolean;
  /** The person's role, as stored. */
  role: Role;
  email: string | null;
  prefix: string;
  createdAt: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  mfaEnabled: boolean;
};

/** Who you are in this system, at a glance: the card beside the profile tabs. */
export async function ProfileSummary(props: Props) {
  const t = await getTranslations("profile.summary");
  const role = await getTranslations("domain.role");
  const format = await getFormatter();
  const date = (value: Date | null, style: "date" | "dateTime") =>
    value ? format.dateTime(value, style) : t("never");

  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: t("email"), value: props.email ?? t("noEmail") },
    { label: t("memberSince"), value: date(props.createdAt, "date") },
    { label: t("lastSignIn"), value: date(props.lastLoginAt, "dateTime") },
    { label: t("passwordChanged"), value: date(props.passwordChangedAt, "date") },
    { label: t("prefix"), value: <span className="font-mono">{props.prefix}</span> },
  ];

  return (
    <Panel aria-label={t("label")} className="overflow-hidden before:hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4 bg-sunken/50 px-5 py-6 sm:px-8 sm:py-7">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-semibold tracking-[-0.02em] text-on-accent sm:size-20 sm:text-2xl"
        >
          {initialsOf(props.name)}
        </span>
        <div className="min-w-0">
          <p className="text-2xl leading-tight font-semibold tracking-[-0.025em] text-fg wrap-break-word sm:text-3xl">
            {props.name}
          </p>
          <p className="mt-1 text-sm text-fg-secondary">{role(props.role)}</p>
        </div>
      </div>
      <PanelBody className="border-t border-border sm:px-8 sm:py-7">
        <dl className="grid gap-x-8 gap-y-6 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs font-medium tracking-[0.04em] text-fg-tertiary uppercase">
                {fact.label}
              </dt>
              <dd className="min-w-0 font-medium text-fg wrap-break-word">{fact.value}</dd>
            </div>
          ))}
          <div className="flex min-w-0 flex-col items-start gap-1">
            <dt className="text-xs font-medium tracking-[0.04em] text-fg-tertiary uppercase">
              {t("twoStep")}
            </dt>
            <dd>
              <Badge
                tone={props.mfaEnabled ? "success" : "warning"}
                icon={props.mfaEnabled ? <CircleCheck /> : <CircleDashed />}
              >
                {props.mfaEnabled ? t("twoStepOn") : t("twoStepOff")}
              </Badge>
            </dd>
          </div>
        </dl>
      </PanelBody>
    </Panel>
  );
}
