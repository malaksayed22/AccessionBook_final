"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Panel, PanelBody } from "@/components/ui/Panel";
import { UnitGroupEditor } from "./UnitGroupEditor";
import { plannedUnits } from "./wizard-state";
import type { StepProps } from "./step-props";
import { useIssueMessage } from "./use-issue-message";

/**
 * Step 2: the material the experiment starts with, as groups of units. Groups are optional: an
 * experiment can start with none and have units registered later.
 */
export function UnitsStep({
  state,
  dispatch,
  errors,
  options,
  onCultivarAdded,
}: StepProps & { onCultivarAdded: (cultivar: { id: number; name: string }) => void }) {
  const t = useTranslations("experiments.wizard.units");
  const message = useIssueMessage();
  const total = plannedUnits(state);

  return (
    <div className="space-y-4">
      {errors.groups ? <Banner tone="danger">{message(errors.groups)}</Banner> : null}

      {state.groups.length === 0 ? (
        <Panel>
          <PanelBody className="space-y-1 text-center">
            <p className="font-medium text-fg">{t("noneTitle")}</p>
            <p className="text-sm text-fg-secondary">{t("noneBody")}</p>
          </PanelBody>
        </Panel>
      ) : (
        state.groups.map((group, index) => (
          <UnitGroupEditor
            key={group.key}
            group={group}
            index={index}
            cultivars={options.cultivars}
            canAddCultivar={options.user.admin}
            onCultivarAdded={onCultivarAdded}
            errors={errors}
            canRemove
            onChange={(patch) => dispatch({ type: "updateGroup", key: group.key, patch })}
            onChangeKind={(kind) => dispatch({ type: "changeKind", key: group.key, kind })}
            onRemove={() => dispatch({ type: "removeGroup", key: group.key })}
          />
        ))
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Plus />} onClick={() => dispatch({ type: "addUnit" })}>
          {t("addUnit")}
        </Button>
        <Button variant="secondary" icon={<Plus />} onClick={() => dispatch({ type: "addGroup" })}>
          {t("addGroup")}
        </Button>
      </div>

      {total > 0 ? (
        <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-fg-secondary" aria-live="polite">
          {t("summary", { count: total })}
        </p>
      ) : null}
    </div>
  );
}
