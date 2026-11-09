"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";

type Props = {
  name: string;
  email: string | null;
  /** Path of the one-time link (`/invite/<token>`). The token is shown once; only its hash is stored. */
  invitePath: string;
  /** ISO timestamp. */
  expiresAt: string;
};

/**
 * A freshly issued invitation link with a copy button, its expiry and, when the address is known, a
 * ready-to-send e-mail. Rendered only after an action, so reading `window` here cannot mismatch the
 * server's HTML.
 */
export function InviteLinkPanel({ name, email, invitePath, expiresAt }: Props) {
  const t = useTranslations("members.link");
  const format = useFormatter();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const link = `${window.location.origin}${invitePath}`;
  const expires = format.dateTime(new Date(expiresAt), "date");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // The clipboard needs a secure page; the field stays selectable.
      setCopyFailed(true);
    }
  }

  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(t("mailSubject"))}&body=${encodeURIComponent(
        t("mailBody", { name, expires, link })
      )}`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-secondary">{t("intro", { name, expires })}</p>

      <Field label={t("fieldLabel")} hint={t("fieldHint")}>
        {(control) => (
          <div className="flex items-stretch gap-2">
            <Input
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 font-mono text-xs"
              {...control}
            />
            <Button
              variant="secondary"
              onClick={copy}
              icon={copied ? <Check /> : <Copy />}
              className="shrink-0"
            >
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        )}
      </Field>

      <div aria-live="polite">
        {copied ? <span className="sr-only">{t("copiedAnnouncement")}</span> : null}
        {copyFailed ? <Banner tone="warning">{t("copyFailed")}</Banner> : null}
      </div>

      {mailto ? (
        <a
          href={mailto}
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm font-medium text-accent-text underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Mail aria-hidden="true" className="size-4" />
          {t("email", { email: email ?? "" })}
        </a>
      ) : null}
    </div>
  );
}
