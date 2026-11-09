"use client";

import { CheckCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";

/** Marks every notice read and redraws the page. */
export function MarkAllReadButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      icon={<CheckCheck />}
      disabled={disabled}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await sendJson("/api/notifications", { all: true });
        setBusy(false);
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
