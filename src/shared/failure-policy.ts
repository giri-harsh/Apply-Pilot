import { AI_ERROR_KINDS, type AIErrorKind } from "@/ai/errors";
import { LIMIT_KINDS, type LimitKind } from "@/background/abort";

/**
 * SPEC 21.3: every kind of failure has a recovery policy, and none of them is "ask the AI to try again". The 13 kinds the
 * spec names come first; the extra ones are real conditions the code distinguishes. `classifyFailure` maps the concrete
 * codes and messages the code base produces onto a kind; the table test fails if a new AI error kind, API error code or
 * limit has no kind, or a kind has no policy.
 */

export const SPEC_FAILURE_KINDS = [
  "temporary_ai_failure",
  "rate_limit",
  "invalid_ai_response",
  "missing_profile_data",
  "field_mapping_ambiguity",
  "element_not_found",
  "element_not_visible",
  "validation_failure",
  "unsupported_control",
  "restricted_context",
  "captcha_or_mfa",
  "navigation_failure",
  "user_cancellation",
] as const;
export const EXTRA_FAILURE_KINDS = ["ai_auth", "ai_quota", "limit_reached", "internal_error", "sensitive_or_risky_field"] as const;
export const FAILURE_KINDS = [...SPEC_FAILURE_KINDS, ...EXTRA_FAILURE_KINDS] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export type Recovery =
  | "continue_without_ai" // deterministic autofill goes on; the AI-dependent part is reported
  | "retry_other_provider_once"
  | "report_and_leave_field"
  | "reobserve_then_retry_bounded"
  | "different_strategy_bounded"
  | "stop_blocked_for_user"
  | "stop_cancelled"
  | "stop_failed";

export type RecoveryPolicy = { recovery: Recovery; maxAttempts: number; askAiToRetry: boolean; note: string };

export const POLICIES: Record<FailureKind, RecoveryPolicy> = {
  temporary_ai_failure: { recovery: "continue_without_ai", maxAttempts: 2, askAiToRetry: false, note: "bounded backoff inside the router, then the deterministic run continues and the fields stay unresolved" },
  rate_limit: { recovery: "retry_other_provider_once", maxAttempts: 1, askAiToRetry: false, note: "one fallback to the second provider; never a retry loop" },
  invalid_ai_response: { recovery: "continue_without_ai", maxAttempts: 1, askAiToRetry: false, note: "tolerant parse once, then rejected item by item; answers and rewrites get ONE regeneration that names the exact violations, then the original wording is used" },
  missing_profile_data: { recovery: "report_and_leave_field", maxAttempts: 0, askAiToRetry: false, note: "nothing is invented; the field is reported unresolved with the reason" },
  field_mapping_ambiguity: { recovery: "report_and_leave_field", maxAttempts: 0, askAiToRetry: false, note: "ambiguous fields are skipped and reported; the optional AI classifier sees each field at most once per step" },
  element_not_found: { recovery: "reobserve_then_retry_bounded", maxAttempts: 2, askAiToRetry: false, note: "fresh observation, then give up with 'Recovery exhausted'" },
  element_not_visible: { recovery: "reobserve_then_retry_bounded", maxAttempts: 2, askAiToRetry: false, note: "a recognised disabled or hidden field is looked at again twice, then reported" },
  validation_failure: { recovery: "different_strategy_bounded", maxAttempts: 2, askAiToRetry: false, note: "default, default, then keyboard typing; then reported failed" },
  unsupported_control: { recovery: "report_and_leave_field", maxAttempts: 0, askAiToRetry: false, note: "left for the user with the reason" },
  restricted_context: { recovery: "stop_blocked_for_user", maxAttempts: 0, askAiToRetry: false, note: "BLOCKED; after a navigation the popup offers the per-origin permission" },
  captcha_or_mfa: { recovery: "stop_blocked_for_user", maxAttempts: 0, askAiToRetry: false, note: "BLOCKED before anything is filled; never interacted with" },
  navigation_failure: { recovery: "stop_blocked_for_user", maxAttempts: 0, askAiToRetry: false, note: "stop instead of clicking again; the user continues" },
  user_cancellation: { recovery: "stop_cancelled", maxAttempts: 0, askAiToRetry: false, note: "every timer and page-side action is cancelled" },
  ai_auth: { recovery: "continue_without_ai", maxAttempts: 0, askAiToRetry: false, note: "a rejected key is not retried; the user fixes it in Settings" },
  ai_quota: { recovery: "retry_other_provider_once", maxAttempts: 1, askAiToRetry: false, note: "fall back once, then continue without AI" },
  limit_reached: { recovery: "stop_blocked_for_user", maxAttempts: 0, askAiToRetry: false, note: "BLOCKED with the limit named and the real report kept" },
  internal_error: { recovery: "stop_failed", maxAttempts: 0, askAiToRetry: false, note: "FAILED with a safe reason" },
  sensitive_or_risky_field: { recovery: "report_and_leave_field", maxAttempts: 0, askAiToRetry: false, note: "sensitive, consent, legal and high-risk fields are never auto-filled" },
};

export const AI_ERROR_TO_FAILURE: Record<AIErrorKind, FailureKind> = {
  timeout: "temporary_ai_failure",
  rate_limit: "rate_limit",
  auth: "ai_auth",
  invalid_response: "invalid_ai_response",
  network: "temporary_ai_failure",
  quota: "ai_quota",
  limit: "limit_reached", // the per-run request budget
  unknown: "temporary_ai_failure",
};

export const API_ERROR_TO_FAILURE: Record<string, FailureKind> = {
  INVALID_MESSAGE: "internal_error",
  UNTRUSTED_SENDER: "internal_error",
  DUPLICATE_RUN: "internal_error",
  NO_RUN: "internal_error",
  NO_PROFILE: "missing_profile_data",
  INJECTION_FAILED: "restricted_context",
  CANCELLED: "user_cancellation",
  INTERNAL: "internal_error",
};

export const LIMIT_TO_FAILURE: Record<LimitKind, FailureKind> = {
  duration: "limit_reached",
  actions: "limit_reached",
  retries: "limit_reached",
  passes: "limit_reached",
  steps: "limit_reached",
  fields: "limit_reached",
};

/** Messages produced by the executor, verifier, mapper and run manager, mapped onto the kinds above (first match wins). */
const MESSAGE_RULES: [RegExp, FailureKind][] = [
  [/captcha|human-verification|verification code|one-time|mfa|sign in/i, "captcha_or_mfa"],
  [/permission lost|cannot access (this )?page|restricted/i, "restricted_context"],
  [/did not respond after moving|did not change the page|no longer a safe next|did not move on/i, "navigation_failure"],
  [/cancelled|stopped by user/i, "user_cancellation"],
  [/limit reached|time limit/i, "limit_reached"],
  [/profile has no value|no valid profile|no profile/i, "missing_profile_data"],
  [/ambiguous|indistinguishable/i, "field_mapping_ambiguity"],
  [/sensitive|consent|third-party|risk level|never auto-filled|never accepts/i, "sensitive_or_risky_field"],
  [/not visible|disabled or read-only|no longer in the page/i, "element_not_visible"],
  [/does not exist|no longer matches|target field does not exist|not found/i, "element_not_found"],
  [/validation message|validation failed|marked invalid|not accepted|does not match the profile value/i, "validation_failure"],
  [/not a (text|select|radio|checkbox) |not a custom dropdown|not an autocomplete|unsupported|not supported|no deterministic profile mapping|file field/i, "unsupported_control"],
];

export type FailureInput = { aiError?: AIErrorKind; apiCode?: string; limit?: LimitKind; message?: string };

export function classifyFailure(i: FailureInput): FailureKind {
  if (i.aiError) return AI_ERROR_TO_FAILURE[i.aiError];
  if (i.apiCode) return API_ERROR_TO_FAILURE[i.apiCode] ?? "internal_error";
  if (i.limit) return LIMIT_TO_FAILURE[i.limit];
  for (const [re, kind] of MESSAGE_RULES) if (re.test(i.message ?? "")) return kind;
  return "internal_error";
}

export { AI_ERROR_KINDS, LIMIT_KINDS };
