import { describe, expect, it } from "vitest";
import { AI_ERROR_KINDS } from "@/ai/errors";
import { LIMIT_KINDS } from "@/background/abort";
import {
  AI_ERROR_TO_FAILURE,
  API_ERROR_TO_FAILURE,
  FAILURE_KINDS,
  LIMIT_TO_FAILURE,
  POLICIES,
  SPEC_FAILURE_KINDS,
  classifyFailure,
  type FailureKind,
} from "@/shared/failure-policy";
import { ErrorResponseSchema } from "@/shared/messages";

describe("SPEC 21.3 failure handling: every failure has a recovery policy (and none is 'ask the AI again')", () => {
  it("all 13 kinds the spec names exist, and every kind has a policy", () => {
    expect(SPEC_FAILURE_KINDS).toHaveLength(13);
    for (const k of FAILURE_KINDS) expect(POLICIES[k], k).toBeDefined();
    expect(Object.keys(POLICIES).sort()).toEqual([...FAILURE_KINDS].sort());
  });

  it("no policy asks the AI to simply try again, and every retry is bounded", () => {
    for (const [k, p] of Object.entries(POLICIES)) {
      expect(p.askAiToRetry, k).toBe(false);
      expect(p.maxAttempts, k).toBeLessThanOrEqual(2);
      expect(p.note.length, k).toBeGreaterThan(10);
    }
  });

  it("every AI error kind, every API error code and every run limit maps to a kind (fails when a new one is added without a policy)", () => {
    for (const k of AI_ERROR_KINDS) expect(FAILURE_KINDS, `AI error ${k}`).toContain(AI_ERROR_TO_FAILURE[k]);
    const codes = ErrorResponseSchema.shape.code.options;
    for (const c of codes) expect(FAILURE_KINDS, `API code ${c}`).toContain(API_ERROR_TO_FAILURE[c]);
    expect(Object.keys(API_ERROR_TO_FAILURE).sort()).toEqual([...codes].sort());
    for (const l of LIMIT_KINDS) expect(FAILURE_KINDS, `limit ${l}`).toContain(LIMIT_TO_FAILURE[l]);
    expect(Object.keys(AI_ERROR_TO_FAILURE).sort()).toEqual([...AI_ERROR_KINDS].sort());
  });

  it.each<[string, FailureKind]>([
    ["A CAPTCHA or human-verification check is on this page", "captcha_or_mfa"],
    ["A verification code (MFA / one-time code) is required", "captcha_or_mfa"],
    ["Permission lost after navigation: the browser no longer lets ApplyPilot read this page", "restricted_context"],
    ["Cannot access this page (restricted page or permission not granted)", "restricted_context"],
    ["The page did not respond after moving to the next step", "navigation_failure"],
    ['"Next" did not change the page; stopping instead of clicking again', "navigation_failure"],
    ["Stopped by user", "user_cancellation"],
    ["Cancelled", "user_cancellation"],
    ["Run limit reached: 8 step transitions", "limit_reached"],
    ["Profile has no value for this field", "missing_profile_data"],
    ["No valid profile saved. Open Settings and complete your profile.", "missing_profile_data"],
    ["Field is ambiguous", "field_mapping_ambiguity"],
    ["Sensitive fields are never auto-filled", "sensitive_or_risky_field"],
    ["Consent fields are never auto-filled", "sensitive_or_risky_field"],
    ["Target is not visible", "element_not_visible"],
    ["Target is disabled or read-only", "element_not_visible"],
    ["Target field does not exist", "element_not_found"],
    ["Target no longer matches the observed field", "element_not_found"],
    ["Validation message: Enter a valid email", "validation_failure"],
    ["Not a custom dropdown", "unsupported_control"],
    ["File field: handled by the resume upload step", "unsupported_control"],
  ])("the message %j is classified as %s", (message, kind) => {
    expect(classifyFailure({ message })).toBe(kind);
    expect(POLICIES[kind].askAiToRetry).toBe(false);
  });

  it("every one of the 13 spec kinds is reachable from at least one real code path", () => {
    const reached = new Set<FailureKind>([
      ...Object.values(AI_ERROR_TO_FAILURE),
      ...Object.values(API_ERROR_TO_FAILURE),
      ...["A CAPTCHA", "Permission lost", "did not respond after moving", "Stopped by user", "Profile has no value", "Field is ambiguous", "Target is not visible", "Target field does not exist", "Validation message: x", "Not a select control"].map((m) => classifyFailure({ message: m })),
    ]);
    for (const k of SPEC_FAILURE_KINDS) expect(reached.has(k), `no code path produces ${k}`).toBe(true);
  });

  it("an unknown message is an internal error, never silently ignored", () => {
    expect(classifyFailure({ message: "something nobody wrote a rule for" })).toBe("internal_error");
  });
});
