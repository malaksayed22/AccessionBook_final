import type { ActionOutcome } from "@/features/action/flow";
import type { ActionBootstrap, ActionUnit } from "@/features/action/types";
import type { ActionId } from "@/lib/action-catalog";

/** Where the launcher was opened: anywhere in the laboratory, on an experiment, or on one unit. */
export type ActionContext = {
  scope: "global" | "unit" | "experiment";
  unitId?: number;
  unitName?: string;
  unitType?: string;
  lifecycleState?: string;
  isDestroyed?: boolean;
  canEdit?: boolean;
  experimentId?: number;
  experimentCode?: string;
  experimentName?: string;
  cultivarId?: number;
};

/** What every action form receives from the dialog. */
export type ActionFormProps = {
  action: ActionId;
  context: ActionContext;
  bootstrap: ActionBootstrap;
  /** The unit in unit scope (read on the server, never taken from props). */
  unit: ActionUnit | null;
  onBack: () => void;
  /** Closes the dialog (used by steps that navigate away). */
  onClose: () => void;
  onComplete: (outcome: ActionOutcome) => void;
  /** Tells the dialog a request is running, so it cannot be dismissed half-way. */
  onBusyChange: (busy: boolean) => void;
};
