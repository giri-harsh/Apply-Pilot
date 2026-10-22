import type { EvidenceBundle } from "@/answers/evidence";
import { validateGrounding, type AnswerClaim, type ViolationRule } from "@/answers/grounding";
import { probe, probeMentions } from "./terms";

export type ExtraRule = "keyword_stuffing" | "unsupported_certification" | "too_long" | "not_shorter" | "missing_item" | "role_inflation" | "unsupported_outcome" | "unsupported_name";
export type TailorViolation = { rule: ViolationRule | ExtraRule; detail: string };

export type CheckInput = {
  text: string;
  claims: AnswerClaim[];
  /** Evidence ids the model cited (unknown ones are ignored); `ownId` is always included. */
  cited: string[];
  /** The item's own evidence id, always counted as cited (omit for a paragraph that cites several items). */
  ownId?: string;
  /** Evidence ids sent for this item. */
  sentIds: string[];
  bundle: EvidenceBundle;
  /** The master wording the rewrite must stay inside, and the technologies of its entry. */
  sourceText: string;
  entryTech: string[];
  /** Every job term (canonical). A term may only appear if it is already in the source. */
  jobTerms: string[];
  maxChars?: number;
  shorterThan?: number;
};

/** Seniority / ownership verbs: reworded text may not claim a bigger role than the source states (SPEC 7.4). */
const ROLE_WORDS = ["led", "lead", "leading", "leader", "managed", "manager", "managing", "owned", "owner", "ownership", "architected", "architect", "directed", "supervised", "headed", "spearheaded", "founded", "founder", "mentored", "oversaw", "orchestrated", "pioneered"];
/** Outcome words: improvements, savings and vague scale may not appear unless the source already says so. */
const OUTCOME_VERBS = ["improved", "improving", "increased", "increasing", "boosted", "boosting", "reduced", "reducing", "cut", "cutting", "saved", "saving", "accelerated", "optimized", "optimised", "enhanced", "grew", "doubled", "tripled"];
const OUTCOME_WORDS = [
  "substantially", "significantly", "dramatically", "greatly", "drastically", "massive", "major", "tremendous", "whole company", "company-wide", "enterprise-wide", "organization-wide",
];
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []);

/**
 * Rules the Phase 6 validator has no equivalent of: invented seniority, invented outcomes, and invented names (tools,
 * products, organisations) that are not in the source. They only ever add violations.
 */
export function inflationViolations(text: string, source: string): TailorViolation[] {
  const out: TailorViolation[] = [];
  const src = words(source);
  const srcLower = source.toLowerCase();
  const txt = words(text);
  const textLower = text.toLowerCase();
  const role = ROLE_WORDS.filter((w) => txt.has(w) && !src.has(w));
  if (role.length > 0) out.push({ rule: "role_inflation", detail: `"${role[0]}" claims a role or ownership the source does not state` });
  const outcome = OUTCOME_WORDS.filter((w) => (w.includes(" ") || w.includes("-") ? textLower.includes(w) && !srcLower.includes(w) : txt.has(w) && !src.has(w)));
  // An outcome verb is a new claim only when the source states no outcome of its own (swapping "reduced" for "cut" is the same claim).
  const sourceHasOutcome = OUTCOME_VERBS.some((w) => src.has(w)) || /\d/.test(source);
  if (!sourceHasOutcome) outcome.push(...OUTCOME_VERBS.filter((w) => txt.has(w)));
  if (outcome.length > 0) out.push({ rule: "unsupported_outcome", detail: `"${outcome[0]}" states an outcome or scale the source does not` });
  // Names: capitalised words after the first, ALLCAPS and CamelCase tokens that the source does not contain.
  const tokens = text.match(/[A-Za-z][A-Za-z0-9.+#_-]*/g) ?? [];
  const unknown = tokens.slice(1).filter((t, idx) => {
    const named = /^[A-Z][a-z]+[A-Z]|^[A-Z]{2,}|[0-9]|^[A-Z][a-z]/.test(t) && t.length > 2;
    if (!named) return false;
    const afterStop = idx === 0 ? false : /[.!?]$/.test(tokens[idx] ?? "");
    return !afterStop && !srcLower.includes(t.toLowerCase());
  });
  if (unknown.length > 0) out.push({ rule: "unsupported_name", detail: `"${unknown[0]}" is a name the source facts do not contain` });
  return out;
}

const CERT = /\b(certif\w*|accredit\w*|licen[sc]ed?)\b/i;

/**
 * The Phase 6 grounding validator plus the two resume-specific rules it does not have (keyword stuffing and
 * certifications), and the length rules. Nothing here loosens a Phase 6 category.
 */
export function checkText(i: CheckInput): TailorViolation[] {
  const out: TailorViolation[] = [];
  const sent = new Set(i.sentIds);
  const cited = [...new Set([...i.cited.filter((id) => sent.has(id)), ...(i.ownId ? [i.ownId] : [])])];
  const fallbackId = i.ownId ?? cited[0] ?? "";

  // Claims are checked against the item they belong to. A claim the source text itself plainly supports is satisfied
  // (the model labels generic concepts such as "forecasting" as technologies); anything else goes to the validator.
  const src = probe(`${i.sourceText} , ${i.entryTech.join(" , ")}`);
  const claims = i.claims
    .map((c) => ({ ...c, evidenceId: sent.has(c.evidenceId) ? c.evidenceId : fallbackId }))
    .filter((c) => !(c.type !== "other" && probeMentions(src, c.text)));

  out.push(...validateGrounding({ answer: i.text, evidenceIds: cited, claims, sentIds: i.sentIds, bundle: i.bundle, questionText: "" }));

  const outP = probe(i.text);
  for (const term of i.jobTerms) {
    if (probeMentions(outP, term) && !probeMentions(src, term)) {
      out.push({ rule: "keyword_stuffing", detail: `The job keyword "${term}" is not in the source facts, so it may not be added` });
    }
  }
  out.push(...inflationViolations(i.text, `${i.sourceText} ${i.entryTech.join(" ")}`));
  if (CERT.test(i.text) && !CERT.test(i.sourceText)) {
    out.push({ rule: "unsupported_certification", detail: "The text mentions a certification or accreditation that the source facts do not" });
  }
  if (i.maxChars !== undefined && i.text.length > i.maxChars) out.push({ rule: "too_long", detail: `The text is ${i.text.length} characters; the limit is ${i.maxChars}` });
  if (i.shorterThan !== undefined && i.text.length >= i.shorterThan) out.push({ rule: "not_shorter", detail: `The text must be shorter than ${i.shorterThan} characters (it is ${i.text.length})` });
  return out;
}

export const violationStrings = (v: TailorViolation[]): string[] => v.slice(0, 10).map((x) => `${x.rule}: ${x.detail}`.slice(0, 200));

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
export const sameWording = (a: string, b: string): boolean => norm(a) === norm(b);
