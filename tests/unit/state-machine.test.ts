import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  RUN_STATES,
  assertTransition,
  canTransition,
  isTerminal,
  isWorking,
} from "@/shared/state-machine";

describe("run state machine", () => {
  it("defines every SPEC 11.8 state", () => {
    expect([...RUN_STATES].sort()).toEqual(
      [
        "IDLE", "INITIALIZING", "OBSERVING", "EXTRACTING_JOB", "DISCOVERING_FORM", "MAPPING_FIELDS",
        "TAILORING_RESUME", "PLANNING", "FILLING", "VERIFYING", "ADVANCING_STEP", "WAITING_FOR_USER",
        "READY_FOR_REVIEW", "COMPLETED", "PARTIALLY_COMPLETED", "BLOCKED", "CANCELLED", "FAILED",
      ].sort(),
    );
  });

  it.each([
    ["IDLE", "INITIALIZING"],
    ["INITIALIZING", "OBSERVING"],
    ["OBSERVING", "DISCOVERING_FORM"],
    ["DISCOVERING_FORM", "MAPPING_FIELDS"],
    ["MAPPING_FIELDS", "FILLING"],
    ["FILLING", "VERIFYING"],
    ["VERIFYING", "READY_FOR_REVIEW"],
    ["READY_FOR_REVIEW", "CANCELLED"],
    ["FILLING", "CANCELLED"],
    ["OBSERVING", "BLOCKED"],
    ["VERIFYING", "FAILED"],
    ["FILLING", "OBSERVING"], // re-observe after a service-worker restart
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ["IDLE", "FILLING"],
    ["IDLE", "READY_FOR_REVIEW"],
    ["INITIALIZING", "FILLING"],
    ["OBSERVING", "READY_FOR_REVIEW"],
    ["DISCOVERING_FORM", "FILLING"],
    ["FILLING", "READY_FOR_REVIEW"],
    ["VERIFYING", "FILLING"],
    ["CANCELLED", "OBSERVING"],
    ["FAILED", "INITIALIZING"],
    ["BLOCKED", "FILLING"],
    ["COMPLETED", "IDLE"],
    ["READY_FOR_REVIEW", "FILLING"],
    ["OBSERVING", "TAILORING_RESUME"], // defined but not wired until its phase
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it("never allows a transition out of a terminal state", () => {
    for (const s of RUN_STATES.filter(isTerminal)) {
      for (const t of RUN_STATES) expect(canTransition(s, t)).toBe(false);
    }
  });

  it("only working states hold the per-tab lock", () => {
    expect(isWorking("FILLING")).toBe(true);
    expect(isWorking("READY_FOR_REVIEW")).toBe(false);
    expect(isWorking("CANCELLED")).toBe(false);
    expect(isWorking("IDLE")).toBe(false);
  });
});
