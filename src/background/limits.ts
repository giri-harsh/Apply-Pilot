/**
 * SPEC 21.2 operational limits for one run. Conservative defaults; every one is enforced by the harness and
 * covered by a test. A run that reaches a limit stops as BLOCKED and says which one.
 */
export type RunLimits = {
  /** Wall-clock budget for the whole run. */
  maxDurationMs: number;
  /** Visible fields on one page. */
  maxFields: number;
  /** One request to the page. */
  stepTimeoutMs: number;
  /** Actions executed across the whole run (every fill, selection and click). */
  maxActions: number;
  /** Retried actions across the whole run. */
  maxRetries: number;
  /** Extra attempts for one failed field, each with a different strategy (SPEC 11.7). */
  maxRecoveryAttempts: number;
  /** Observe-map-fill passes on one step (dynamic fields appear after earlier fills). */
  maxPassesPerStep: number;
  /** Step transitions (clicks on a next-step control). */
  maxStepTransitions: number;
  /** DOM must be quiet this long before the next observation. */
  settleQuietMs: number;
  settleMaxMs: number;
  /** Pause before re-observing a field that is disabled right now (it may be enabled by an earlier answer or a timer). */
  disabledRetryMs: number;
  /** How long to wait for a full page navigation to finish after clicking next. */
  navigationTimeoutMs: number;
};

export const DEFAULT_LIMITS: RunLimits = {
  maxDurationMs: 180_000,
  maxFields: 300,
  stepTimeoutMs: 20_000,
  maxActions: 200,
  maxRetries: 12,
  maxRecoveryAttempts: 2,
  maxPassesPerStep: 4,
  maxStepTransitions: 8,
  settleQuietMs: 150,
  settleMaxMs: 2000,
  disabledRetryMs: 1000,
  navigationTimeoutMs: 10_000,
};
