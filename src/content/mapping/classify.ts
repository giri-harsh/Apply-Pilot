import { SENSITIVE_TYPES, type ControlKind, type LabelSource, type Risk, type SemanticType } from "@/shared/form";
import { matchAliases, THIRD_PARTY_SECTION } from "@/shared/aliases";

export type Signal = { source: LabelSource; text: string };

export type Classification = {
  semanticType: SemanticType;
  candidates: SemanticType[];
  confidence: number;
  ambiguous: boolean;
  ambiguityReason: string | null;
  risk: Risk;
};

/** Confidence a match earns depending on where the evidence came from. Calibrated by tests, not by a model. */
const SOURCE_CONFIDENCE: Record<LabelSource, number> = {
  explicit_label: 0.95,
  aria_labelledby: 0.95,
  aria_label: 0.93,
  name_or_id: 0.85,
  placeholder: 0.8,
  legend: 0.9,
  nearby_text: 0.6,
  section_heading: 0.4,
  none: 0,
};

/** Sources whose disagreement makes a field ambiguous. Nearby text and headings are context only. */
const AUTHORITATIVE: LabelSource[] = [
  "explicit_label",
  "aria_labelledby",
  "aria_label",
  "name_or_id",
  "placeholder",
  "legend",
];

export function riskFor(type: SemanticType, control: ControlKind): Risk {
  if (type === "consent") return "high";
  if (SENSITIVE_TYPES.includes(type)) return "high";
  if (type === "open_ended") return "moderate";
  if (control === "file") return "moderate";
  if (type === "unknown") return "moderate";
  return "low";
}

export function classifyField(signals: Signal[], control: ControlKind, sectionContext: string): Classification {
  const hits: { source: LabelSource; type: SemanticType; confidence: number; exact: boolean }[] = [];
  for (const s of signals) {
    const m = matchAliases(s.text);
    if (m) hits.push({ source: s.source, type: m.type, confidence: SOURCE_CONFIDENCE[s.source], exact: m.exact });
  }

  if (control === "file") {
    const u = hits.find((h) => h.type === "resume_upload" || h.type === "cover_letter_upload");
    const type: SemanticType = u ? u.type : "other_upload";
    return build(type, [type], u?.confidence ?? 0.5, false, null, control);
  }

  if (hits.length === 0) {
    const type: SemanticType = control === "textarea" ? "open_ended" : "unknown";
    return build(type, [type], control === "textarea" ? 0.5 : 0, false, null, control);
  }

  const best = hits[0]!; // signals arrive in priority order
  let confidence = best.confidence;
  if (best.exact) confidence = Math.min(0.99, confidence + 0.04);

  const authoritative = hits.filter((h) => AUTHORITATIVE.includes(h.source));
  const distinct = Array.from(new Set(authoritative.map((h) => h.type)));
  const candidates = Array.from(new Set(hits.map((h) => h.type)));
  let ambiguous = false;
  let reason: string | null = null;
  if (distinct.length > 1) {
    ambiguous = true;
    reason = `Conflicting signals: ${distinct.join(" vs ")}`;
  }

  let type = best.type;
  // Applicant-identity fields inside a reference / emergency-contact section belong to someone else.
  if (THIRD_PARTY_SECTION.test(sectionContext) && !SENSITIVE_TYPES.includes(type) && type !== "consent") {
    type = "third_party_contact";
  }
  return build(type, candidates, confidence, ambiguous, reason, control);
}

function build(
  semanticType: SemanticType,
  candidates: SemanticType[],
  confidence: number,
  ambiguous: boolean,
  ambiguityReason: string | null,
  control: ControlKind,
): Classification {
  return { semanticType, candidates, confidence, ambiguous, ambiguityReason, risk: riskFor(semanticType, control) };
}
