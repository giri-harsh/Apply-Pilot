export const RUN_STATES = [
  "IDLE",
  "INITIALIZING",
  "OBSERVING",
  "EXTRACTING_JOB",
  "DISCOVERING_FORM",
  "MAPPING_FIELDS",
  "TAILORING_RESUME",
  "PLANNING",
  "FILLING",
  "VERIFYING",
  "ADVANCING_STEP",
  "WAITING_FOR_USER",
  "READY_FOR_REVIEW",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "BLOCKED",
  "CANCELLED",
  "FAILED",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_STATES: readonly RunState[] = [
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "BLOCKED",
  "CANCELLED",
  "FAILED",
];

/** Runs in these states hold the per-tab lock. READY_FOR_REVIEW is waiting on the user, not working. */
const WORKING_STATES: readonly RunState[] = [
  "INITIALIZING",
  "OBSERVING",
  "DISCOVERING_FORM",
  "MAPPING_FIELDS",
  "PLANNING",
  "FILLING",
  "VERIFYING",
];

const ABORTS: RunState[] = ["BLOCKED", "CANCELLED", "FAILED"];

/**
 * Only transitions used by Phases 1-3 are allowed. States such as EXTRACTING_JOB or TAILORING_RESUME
 * are defined for the type but have no edges until their phases are built.
 */
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  IDLE: ["INITIALIZING"],
  INITIALIZING: ["OBSERVING", ...ABORTS],
  // A restarted service worker re-observes instead of replaying (SPEC 15.3), hence the edges back to OBSERVING.
  OBSERVING: ["DISCOVERING_FORM", ...ABORTS],
  DISCOVERING_FORM: ["MAPPING_FIELDS", "OBSERVING", ...ABORTS],
  MAPPING_FIELDS: ["PLANNING", "OBSERVING", ...ABORTS],
  PLANNING: ["FILLING", "OBSERVING", ...ABORTS],
  FILLING: ["VERIFYING", "OBSERVING", ...ABORTS],
  VERIFYING: ["READY_FOR_REVIEW", "PARTIALLY_COMPLETED", "OBSERVING", ...ABORTS],
  READY_FOR_REVIEW: ["COMPLETED", "CANCELLED"],
  EXTRACTING_JOB: [],
  TAILORING_RESUME: [],
  ADVANCING_STEP: [],
  WAITING_FOR_USER: [],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  BLOCKED: [],
  CANCELLED: [],
  FAILED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunState,
    readonly to: RunState,
  ) {
    super(`Invalid run state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** True while a run owns its tab and a second Quick Apply must be rejected. */
export function isWorking(state: RunState): boolean {
  return WORKING_STATES.includes(state);
}

export const STATE_LABELS: Record<RunState, string> = {
  IDLE: "Idle",
  INITIALIZING: "Starting...",
  OBSERVING: "Inspecting page...",
  EXTRACTING_JOB: "Reading job description...",
  DISCOVERING_FORM: "Discovering form fields...",
  MAPPING_FIELDS: "Mapping fields...",
  TAILORING_RESUME: "Tailoring resume...",
  PLANNING: "Planning...",
  FILLING: "Filling fields...",
  VERIFYING: "Verifying entries...",
  ADVANCING_STEP: "Advancing...",
  WAITING_FOR_USER: "Waiting for you",
  READY_FOR_REVIEW: "Ready for your review",
  COMPLETED: "Completed",
  PARTIALLY_COMPLETED: "Partially completed - review needed",
  BLOCKED: "Blocked",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};
