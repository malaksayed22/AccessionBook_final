"use client";

import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";

/** One notice on the notifications page: opening it marks it read, then goes to its record. */
export function NotificationLink({
  id,
  href,
  read,
  children,
}: {
  id: number;
  href: string | null;
  read: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="flex w-full items-start gap-4 px-5 py-4 text-start text-[0.9375rem] leading-6 transition-colors hover:bg-hover/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-8"
      onClick={async () => {
        if (!read) await sendJson("/api/notifications", { id });
        if (href) router.push(href);
        else router.refresh();
      }}
    >
      {children}
    </button>
  );
}
