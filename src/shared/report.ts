import type { CompletionReport, FieldResult, FormField } from "./form";
import type { ExecutionResult, PlannedFill, VerificationResult } from "./messages";

/**
 * Builds the completion report only from observed facts (SPEC 18.4).
 * filled   = actions that executed without error
 * verified = filled fields whose rendered value was re-read and showed no validation error
 * failed   = planned fields that did not end up verified (execution error or failed verification)
 */
export function buildReport(
  fields: FormField[],
  plan: PlannedFill[],
  skipped: FieldResult[],
  executed: ExecutionResult[],
  verified: VerificationResult[],
): CompletionReport {
  const exec = new Map(executed.map((r) => [r.fieldId, r]));
  const ver = new Map(verified.map((r) => [r.fieldId, r]));
  const results: FieldResult[] = [...skipped];

  let filled = 0;
  let verifiedCount = 0;
  let failed = 0;
  for (const p of plan) {
    const e = exec.get(p.fieldId);
    const v = ver.get(p.fieldId);
    const base = { fieldId: p.fieldId, label: p.label, required: p.required, semanticType: p.semanticType };
    if (!e || !e.executed) {
      failed++;
      results.push({ ...base, outcome: "failed", reason: e?.error ?? "Not executed" });
      continue;
    }
    filled++;
    if (v?.verified) {
      verifiedCount++;
      results.push({ ...base, outcome: "filled_verified", reason: v.reason });
    } else {
      failed++;
      results.push({ ...base, outcome: "failed", reason: v?.reason ?? "Not verified" });
    }
  }

  const count = (o: FieldResult["outcome"]) => skipped.filter((s) => s.outcome === o).length;
  const unresolved = skipped.filter((s) => s.outcome === "unresolved" || s.outcome === "skipped_third_party" || s.outcome === "skipped_consent");
  return {
    totalFields: fields.filter((f) => f.visible).length,
    filled,
    verified: verifiedCount,
    failed,
    skippedSensitive: count("skipped_sensitive"),
    ambiguous: count("ambiguous"),
    unresolved: unresolved.length,
    alreadyCorrect: count("already_correct"),
    requiredUnresolved: results.filter(
      (r) => r.required && !["filled_verified", "already_correct"].includes(r.outcome),
    ).length,
    results,
  };
}
