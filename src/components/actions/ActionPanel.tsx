"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useReducer, type ComponentType } from "react";
import { UnitStatusBadge } from "@/components/page/domain-badges";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { initialLauncherState, launcherReducer, type ActionOutcome } from "@/features/action/flow";
import {
  availableActions,
  findAction,
  groupActions,
  isActionAvailable,
  type ActionId,
  type AvailabilityInput,
} from "@/lib/action-catalog";
import { useApiError, useNetworkError } from "@/lib/api-error";
import { ActionDone, doneMessage } from "./ActionDone";
import { ActionMenu } from "./ActionMenu";
import { ExperimentStep } from "./forms/ExperimentStep";
import { DeriveForm } from "./forms/DeriveForm";
import { DestroyForm } from "./forms/DestroyForm";
import { PlaceHoldForm, ReleaseHoldForm } from "./forms/HoldForm";
import { MeasureForm } from "./forms/MeasureForm";
import { MoveForm } from "./forms/MoveForm";
import { ActivityForm, AttachForm } from "./forms/RecordForms";
import { RegisterForm } from "./forms/RegisterForm";
import { ShipForm } from "./forms/ShipForm";
import { StageForm } from "./forms/StageForm";
import type { ActionContext, ActionFormProps } from "./types";
import { useActionBootstrap } from "./use-action-bootstrap";
import { isQuality, isReadOnly } from "@/lib/roles";

const FORMS: Record<ActionId, ComponentType<ActionFormProps>> = {
  new_experiment: ExperimentStep,
  new_sub_experiment: ExperimentStep,
  register_units: RegisterForm,
  receive_units: RegisterForm,
  derive: DeriveForm,
  change_stage: StageForm,
  measure: MeasureForm,
  move: MoveForm,
  ship: ShipForm,
  place_hold: PlaceHoldForm,
  release_hold: ReleaseHoldForm,
  destroy: DestroyForm,
  log_activity: ActivityForm,
  attach_file: AttachForm,
};

type ActionPanelProps = {
  context: ActionContext;
  initialAction?: ActionId;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};

/**
 * Everything inside the dialog. Mounted only while the dialog is open, so each opening starts from
 * the menu with fresh data and empty forms; there is no reset logic to get wrong.
 */
export function ActionPanel({ context, initialAction, onClose, onBusyChange }: ActionPanelProps) {
  const t = useTranslations("actions");
  const ui = useTranslations("ui");
  const apiError = useApiError();
  const networkError = useNetworkError();
  const { toast } = useToast();
  const unitId = context.scope === "unit" ? context.unitId : undefined;
  const { state, reload } = useActionBootstrap(unitId);
  const [flow, dispatch] = useReducer(launcherReducer, initialAction, initialLauncherState);

  // If the dialog closes mid-request nothing is pending any more.
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const complete = useCallback(
    (action: ActionId, outcome: ActionOutcome) => {
      toast({ tone: "success", title: doneMessage(t, action, outcome) });
      dispatch({ type: "complete", outcome });
    },
    [t, toast]
  );

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{ui("loading")}</span>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Banner tone="danger" title={t("launcher.loadFailed")}>
          {state.network ? networkError : apiError(state.body)}
        </Banner>
        <Button variant="secondary" onClick={reload}>
          {t("launcher.retry")}
        </Button>
      </div>
    );
  }

  const bootstrap = state.data;
  const unit = bootstrap.unit;
  if (context.scope === "unit" && !unit) {
    return <Banner tone="warning">{t("launcher.unitMissing")}</Banner>;
  }

  // The server's view of the unit is the authority; the page's `canEdit` can only narrow it.
  const facts = unit
    ? {
        type: unit.type,
        status: unit.status,
        nothingLeft: unit.nothingLeft,
        canEdit: unit.canEdit && context.canEdit !== false,
      }
    : null;
  const input: AvailabilityInput = {
    scope: context.scope,
    isAdmin: bootstrap.user.permissions === "ADMIN",
    isQuality: isQuality(bootstrap.user),
    readOnly: isReadOnly(bootstrap.user),
    canEditExperiment: context.canEdit,
    hasExperiments: bootstrap.experiments.length > 0,
    unit: facts,
  };

  const chosen =
    flow.phase !== "menu" && isActionAvailable(findAction(flow.action), input) ? flow.action : null;
  const Form = chosen ? FORMS[chosen] : null;

  return (
    <div className="flex flex-col gap-4">
      {unit && flow.phase === "menu" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium wrap-break-word">{unit.name}</span>
          <UnitStatusBadge status={unit.status} linked={false} />
        </div>
      ) : null}

      {flow.phase === "done" ? (
        <ActionDone
          action={flow.action}
          outcome={flow.outcome}
          onAgain={() => {
            dispatch({ type: "again" });
            reload();
          }}
          onClose={onClose}
        />
      ) : Form && chosen ? (
        <Form
          action={chosen}
          context={context}
          bootstrap={bootstrap}
          unit={unit}
          onBack={() => dispatch({ type: "back" })}
          onClose={onClose}
          onComplete={(outcome) => complete(chosen, outcome)}
          onBusyChange={onBusyChange}
        />
      ) : (
        <Menu
          input={input}
          readOnly={Boolean(facts) && facts?.canEdit === false}
          onChoose={(action) => dispatch({ type: "choose", action })}
        />
      )}

      <p className="flex items-start gap-2 border-t border-border pt-3 text-xs text-fg-secondary">
        <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {t("launcher.footer")}
      </p>
    </div>
  );
}

function Menu({
  input,
  readOnly,
  onChoose,
}: {
  input: AvailabilityInput;
  readOnly: boolean;
  onChoose: (action: ActionId) => void;
}) {
  const t = useTranslations("actions");
  const groups = groupActions(availableActions(input));

  return (
    <>
      {readOnly ? <Banner tone="info">{t("launcher.readOnly")}</Banner> : null}
      {groups.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={t("launcher.emptyTitle")}
          description={t("launcher.emptyBody")}
        />
      ) : (
        <ActionMenu groups={groups} onChoose={onChoose} />
      )}
    </>
  );
}
