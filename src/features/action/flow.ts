import type { ActionId } from "@/lib/action-catalog";

/**
 * The launcher is a three-phase flow: pick an action (menu), fill it in (form), read the outcome
 * (done). The state is a discriminated union so an impossible combination (a result without an
 * action, a form without one) cannot be represented, and the transitions are a pure reducer.
 */
export type ActionOutcome = {
  /** Values for the `actions.done.<action>` message (names, counts, stage keys already translated). */
  values: Record<string, string | number>;
  /** Where "View" should go (locale-less path such as `/inventory/units/12`), if the action produced a record. */
  href?: string;
};

export type LauncherState =
  | { phase: "menu" }
  | { phase: "form"; action: ActionId }
  | { phase: "done"; action: ActionId; outcome: ActionOutcome };

export type LauncherEvent =
  | { type: "choose"; action: ActionId }
  | { type: "back" }
  | { type: "complete"; outcome: ActionOutcome }
  | { type: "again" };

export function initialLauncherState(initial?: ActionId): LauncherState {
  return initial ? { phase: "form", action: initial } : { phase: "menu" };
}

export function launcherReducer(state: LauncherState, event: LauncherEvent): LauncherState {
  switch (event.type) {
    case "choose":
      return state.phase === "menu" ? { phase: "form", action: event.action } : state;
    case "back":
      return state.phase === "form" ? { phase: "menu" } : state;
    case "complete":
      return state.phase === "form"
        ? { phase: "done", action: state.action, outcome: event.outcome }
        : state;
    case "again":
      return state.phase === "done" ? { phase: "menu" } : state;
  }
}
