import type { CompletionReport, FieldResult, FormField, StepSummary } from "./form";
import type { ExecutionResult, PlannedFill, VerificationResult } from "./messages";

/**
 * Builds completion reports only from observed facts (SPEC 18.4).
 * filled   = fields whose action executed without error (verified, or executed but failed verification)
 * verified = filled fields whose rendered value was re-read and showed no validation error
 * failed   = planned fields that did not end up verified (execution error or failed verification)
 * aiMapped / aiWritten = verified fills whose type / text came from an accepted model answer
 */

type Counts = Omit<StepSummary, "index" | "url" | "title" | "advancedBy" | "outcome" | "note"> & { aiMapped: number; aiWritten: number };

/** Higher wins when the same field gets a result in more than one pass of a step. */
const RANK: Record<FieldResult["outcome"], number> = {
  filled_verified: 6,
  already_correct: 5,
  failed: 4,
  filled_unverified: 4,
  ambiguous: 3,
  skipped_sensitive: 3,
  skipped_consent: 3,
  skipped_third_party: 3,
  unresolved: 2,
};

export function countResults(results: FieldResult[]): Counts {
  const count = (o: FieldResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const verified = count("filled_verified");
  const failed = count("failed");
  return {
    totalFields: results.length,
    filled: verified + results.filter((r) => r.outcome === "failed" && r.executed).length,
    verified,
    failed,
    skippedSensitive: count("skipped_sensitive"),
    ambiguous: count("ambiguous"),
    unresolved: results.filter((r) => r.outcome === "unresolved" || r.outcome === "skipped_third_party" || r.outcome === "skipped_consent").length,
    alreadyCorrect: count("already_correct"),
    requiredUnresolved: results.filter((r) => r.required && !["filled_verified", "already_correct"].includes(r.outcome)).length,
    aiMapped: results.filter((r) => r.outcome === "filled_verified" && r.aiMapped).length,
    aiWritten: results.filter((r) => r.outcome === "filled_verified" && r.aiWritten).length,
  };
}

/** Accumulates the results of every pass over one step, keeping the best outcome per field. */
export class StepAccumulator {
  private results = new Map<string, FieldResult>();

  private merge(r: FieldResult): void {
    const key = r.fingerprint ?? r.fieldId;
    const old = this.results.get(key);
    // A later "still unresolved" must not replace an earlier, more specific reason (for example a rejected AI answer).
    if (!old || RANK[r.outcome] > RANK[old.outcome]) this.results.set(key, r);
    else if (RANK[r.outcome] === RANK[old.outcome] && RANK[r.outcome] >= 4) {
      // A field that was typed into in an earlier pass stays "filled" even when the last attempt was only a give-up note.
      this.results.set(key, { ...r, executed: Boolean(old.executed || r.executed) });
    }
  }

  addPass(plan: PlannedFill[], skipped: FieldResult[], executed: ExecutionResult[], verified: VerificationResult[]): void {
    for (const s of skipped) this.merge(s);
    const exec = new Map(executed.map((r) => [r.fieldId, r]));
    const ver = new Map(verified.map((r) => [r.fieldId, r]));
    for (const p of plan) {
      const e = exec.get(p.fieldId);
      const v = ver.get(p.fieldId);
      const base = {
        fieldId: p.fieldId,
        label: p.label,
        required: p.required,
        semanticType: p.semanticType,
        ...(p.fingerprint ? { fingerprint: p.fingerprint } : {}),
        ...(p.aiMapped ? { aiMapped: true } : {}),
        ...(p.aiWritten ? { aiWritten: true, evidence: p.evidence ?? [] } : {}),
      };
      const dims = (execution: number | null, verification: number | null) => ({
        identification: p.confidence?.identification ?? 0,
        mapping: p.confidence?.mapping ?? 0,
        profileEvidence: 1, // a plan only exists when the profile held a value
        execution,
        verification,
      });
      if (!e || !e.executed) {
        this.merge({ ...base, outcome: "failed", executed: false, reason: e?.error ?? "Not executed", confidence: dims(0, null) });
      } else if (v?.verified) {
        this.merge({ ...base, outcome: "filled_verified", executed: true, reason: v.reason, confidence: dims(1, 1) });
      } else {
        this.merge({ ...base, outcome: "failed", executed: true, reason: v?.reason ?? "Not verified", confidence: dims(1, 0) });
      }
    }
  }

  list(): FieldResult[] {
    return [...this.results.values()];
  }

  counts(): Counts {
    return countResults(this.list());
  }
}

/** Single-pass report (one step), used by the simple path and by unit tests. */
export function buildReport(
  _fields: FormField[],
  plan: PlannedFill[],
  skipped: FieldResult[],
  executed: ExecutionResult[],
  verified: VerificationResult[],
): CompletionReport {
  const acc = new StepAccumulator();
  acc.addPass(plan, skipped, executed, verified);
  const results = acc.list();
  const c = countResults(results);
  return { ...c, steps: [], notes: [], results };
}

export type StepRecordLike = StepSummary & { results: FieldResult[] };

/** The report for a whole run: totals across steps, every step's real counts, and the honest notes. */
export function combineReport(steps: StepRecordLike[], notes: string[]): CompletionReport {
  const results = steps.flatMap((s) => s.results.map((r) => ({ ...r, step: s.index })));
  const c = countResults(results);
  return {
    ...c,
    steps: steps.map((s) => {
      const { results: _results, ...summary } = s;
      void _results;
      return summary;
    }),
    notes: notes.slice(0, 20),
    results,
  };
}
