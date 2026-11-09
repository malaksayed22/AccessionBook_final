"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/FormControls";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { sendJson } from "@/lib/client-api";
import { useRequestAction } from "./use-request-action";

/** Names the procedure an incident departed from, or clears it. Quality assurance only. */
export function IncidentSopForm({
  incidentId,
  sopId,
  sops,
}: {
  incidentId: number;
  sopId: number | null;
  sops: ReadonlyArray<{ id: number; code: string; title: string }>;
}) {
  const t = useTranslations("qa.capa");
  const router = useRouter();
  const { toast } = useToast();
  const action = useRequestAction();
  const [value, setValue] = useState(sopId ? String(sopId) : "");
  const changed = value !== (sopId ? String(sopId) : "");

  async function save() {
    const result = await action.run(() =>
      sendJson(
        `/api/qa/incidents/${incidentId}`,
        { sopId: value === "" ? null : Number(value) },
        "PATCH"
      )
    );
    if (!result.ok) {
      toast({ tone: "danger", title: action.error ?? t("sopFailed") });
      return;
    }
    toast({ tone: "success", title: t("sopSaved") });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t("sop")}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-0 flex-1"
      >
        <option value="">{t("sopNone")}</option>
        {sops.map((sop) => (
          <option key={sop.id} value={sop.id}>
            {sop.code} · {sop.title}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="secondary"
        className="min-h-10 shrink-0 pointer-coarse:min-h-11"
        disabled={!changed}
        loading={action.pending}
        onClick={() => void save()}
      >
        {t("sopSave")}
      </Button>
    </div>
  );
}
