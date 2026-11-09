import type { Dispatch } from "react";
import type { WizardOptions } from "@/features/experiment/queries";
import type { StepErrors } from "./wizard-validation";
import type { WizardAction, WizardState } from "./wizard-state";

/** What every wizard step receives. `errors` is empty until the person has tried to leave the step. */
export type StepProps = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  errors: StepErrors;
  options: WizardOptions;
};
