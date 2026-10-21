import { SENSITIVE_TYPES, type FieldResult, type FormField, type SemanticType } from "@/shared/form";

/** Types the AI may never be asked about, whatever the label says (SPEC 14.5 / 17.2). */
const NEVER_TO_AI: readonly SemanticType[] = [
  ...SENSITIVE_TYPES,
  "consent",
  "third_party_contact",
  "resume_upload",
  "cover_letter_upload",
  "other_upload",
  "open_ended",
];

export type CandidateSelection = { candidates: FormField[]; overflow: FormField[] };

/**
 * Deterministic gate that runs BEFORE any AI call. A field is a candidate only if the rules tried and
 * failed to place it: unknown type, low-confidence type, or conflicting signals. Everything sensitive,
 * legal, consent, file, hidden, disabled or already-populated never leaves the browser.
 */
export function selectCandidates(fields: FormField[], skipped: FieldResult[], maxFields: number): CandidateSelection {
  const unresolvedIds = new Set(skipped.filter((s) => s.outcome === "unresolved" || s.outcome === "ambiguous").map((s) => s.fieldId));
  const eligible: FormField[] = [];
  for (const f of fields) {
    if (!unresolvedIds.has(f.fieldId)) continue;
    if (!f.visible || !f.enabled) continue;
    if (f.widget !== "native") continue; // typing cannot select from a custom list
    if (f.control !== "text" && f.control !== "select" && f.control !== "textarea") continue;
    if (NEVER_TO_AI.includes(f.semanticType)) continue;
    if (f.risk === "high" || f.risk === "restricted") continue;
    if (f.control !== "select" && f.currentValue.trim() !== "") continue;
    if (f.ambiguous && !(f.ambiguityReason ?? "").startsWith("Conflicting signals")) continue; // duplicates cannot be resolved by a model
    if (!f.signals.some((s) => !/^(autocomplete|inputtype):/.test(s.text) && s.text.trim() !== "")) continue; // nothing to classify
    const understood = f.semanticType !== "unknown" && f.confidence >= 0.8 && !f.ambiguous;
    if (understood) continue; // the rules understood it; it was skipped for another reason (e.g. no profile value)
    eligible.push(f);
  }
  return { candidates: eligible.slice(0, maxFields), overflow: eligible.slice(maxFields) };
}
