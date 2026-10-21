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
    ["OBSERVING", "EXTRACTING_JOB"],
    ["EXTRACTING_JOB", "DISCOVERING_FORM"],
    ["EXTRACTING_JOB", "OBSERVING"],
    ["EXTRACTING_JOB", "BLOCKED"],
    ["EXTRACTING_JOB", "CANCELLED"],
    ["DISCOVERING_FORM", "MAPPING_FIELDS"],
    ["MAPPING_FIELDS", "PLANNING"],
    ["PLANNING", "FILLING"],
    ["PLANNING", "OBSERVING"],
    ["PLANNING", "CANCELLED"],
    ["PLANNING", "BLOCKED"],
    ["PLANNING", "FAILED"],
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
    ["OBSERVING", "DISCOVERING_FORM"], // job extraction always sits in between now
    ["EXTRACTING_JOB", "MAPPING_FIELDS"],
    ["EXTRACTING_JOB", "FILLING"],
    ["IDLE", "EXTRACTING_JOB"],
    ["DISCOVERING_FORM", "EXTRACTING_JOB"],
    ["OBSERVING", "READY_FOR_REVIEW"],
    ["DISCOVERING_FORM", "FILLING"],
    ["DISCOVERING_FORM", "PLANNING"],
    ["MAPPING_FIELDS", "FILLING"], // must pass through PLANNING now
    ["PLANNING", "VERIFYING"],
    ["PLANNING", "READY_FOR_REVIEW"],
    ["IDLE", "PLANNING"],
    ["FILLING", "PLANNING"],
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
    expect(isWorking("PLANNING")).toBe(true);
    expect(isWorking("EXTRACTING_JOB")).toBe(true);
    expect(isWorking("READY_FOR_REVIEW")).toBe(false);
    expect(isWorking("CANCELLED")).toBe(false);
    expect(isWorking("IDLE")).toBe(false);
  });
});
