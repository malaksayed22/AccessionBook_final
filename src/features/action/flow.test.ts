import { describe, expect, it } from "vitest";
import { initialLauncherState, launcherReducer, type LauncherState } from "./flow";

const outcome = { values: { name: "U-1" }, href: "/units/1" };

describe("launcher flow", () => {
  it("starts at the menu, or straight in an action when one is requested", () => {
    expect(initialLauncherState()).toEqual({ phase: "menu" });
    expect(initialLauncherState("move")).toEqual({ phase: "form", action: "move" });
  });

  it("walks menu, form, done and back to the menu", () => {
    let state: LauncherState = initialLauncherState();
    state = launcherReducer(state, { type: "choose", action: "destroy" });
    expect(state).toEqual({ phase: "form", action: "destroy" });
    state = launcherReducer(state, { type: "complete", outcome });
    expect(state).toEqual({ phase: "done", action: "destroy", outcome });
    state = launcherReducer(state, { type: "again" });
    expect(state).toEqual({ phase: "menu" });
  });

  it("goes back from a form to the menu", () => {
    const state = launcherReducer({ phase: "form", action: "measure" }, { type: "back" });
    expect(state).toEqual({ phase: "menu" });
  });

  it("ignores events that do not apply to the current phase", () => {
    const menu: LauncherState = { phase: "menu" };
    expect(launcherReducer(menu, { type: "complete", outcome })).toBe(menu);
    expect(launcherReducer(menu, { type: "back" })).toBe(menu);
    const form: LauncherState = { phase: "form", action: "move" };
    expect(launcherReducer(form, { type: "choose", action: "ship" })).toBe(form);
    const done: LauncherState = { phase: "done", action: "move", outcome };
    expect(launcherReducer(done, { type: "back" })).toBe(done);
  });
});
