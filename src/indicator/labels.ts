import type { RunState } from "@/shared/state-machine";

/** SPEC 5.3 labels for the in-page indicator, from the run state. Plain words; no field names, no values. */

export const INDICATOR_SETTINGS_KEY = "applypilot.indicator.settings.v1";
export const INDICATOR_AUTOHIDE_MS = 6000;

export type IndicatorTone = "working" | "done" | "blocked";
export type IndicatorView = { label: string; tone: IndicatorTone; final: boolean };

const WORKING: Partial<Record<RunState, string>> = {
  INITIALIZING: "Inspecting page",
  OBSERVING: "Inspecting page",
  EXTRACTING_JOB: "Reading job description",
  DISCOVERING_FORM: "Mapping fields",
  MAPPING_FIELDS: "Mapping fields",
  PLANNING: "Mapping fields",
  TAILORING_RESUME: "Tailoring resume",
  FILLING: "Filling fields",
  VERIFYING: "Verifying entries",
  ADVANCING_STEP: "Moving to the next step",
  WAITING_FOR_USER: "Waiting for you",
};

export function viewFor(state: RunState, reason: string | null): IndicatorView | null {
  const w = WORKING[state];
  if (w) return { label: w, tone: "working", final: false };
  switch (state) {
    case "READY_FOR_REVIEW":
      return { label: "Ready for your review", tone: "done", final: true };
    case "COMPLETED":
      return { label: "Done", tone: "done", final: true };
    case "PARTIALLY_COMPLETED":
      return { label: "Partly done: needs your attention", tone: "blocked", final: true };
    case "BLOCKED":
      return { label: `Blocked${reason ? `: ${reason.slice(0, 60)}` : ""}`, tone: "blocked", final: true };
    case "FAILED":
      return { label: "Stopped: something went wrong", tone: "blocked", final: true };
    case "CANCELLED":
      return { label: "Stopped", tone: "done", final: true };
    default:
      return null;
  }
}
