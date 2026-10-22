import type { JobContext } from "@/job/schema";
import { canonicalSkill, extractSkills } from "@/job/skills";

/**
 * Job-term matching shared by relevance scoring, variant selection and the keyword-stuffing guard. Terms are
 * canonicalised with the Phase 5 dictionary (so "sklearn" == "scikit-learn", "ML" == "Machine Learning") and, for
 * words the dictionary does not know, matched as stemmed phrases.
 */

const stem = (w: string): string => (w.length > 3 ? w.replace(/ies$/, "y").replace(/([^s])s$/, "$1") : w);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(stem);
}

function containsPhrase(tokens: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

/** Canonical dictionary skills found in `text`. */
export function skillSetOf(text: string): Set<string> {
  return new Set(extractSkills(text).map(canonicalSkill));
}

export type TextProbe = { tokens: string[]; skills: Set<string> };
export const probe = (text: string): TextProbe => ({ tokens: tokenize(text), skills: skillSetOf(text) });

/** True when `term` (a raw or canonical skill / keyword) is present in the probed text. */
export function probeMentions(p: TextProbe, term: string): boolean {
  const canon = canonicalSkill(term);
  if (p.skills.has(canon)) return true;
  const t = tokenize(term);
  // One- and two-letter terms (R, Go, C) are only trusted through the dictionary, which knows their context.
  if (t.length === 1 && t[0]!.length <= 2) return false;
  return containsPhrase(p.tokens, t);
}

export type JobTerms = { weights: Map<string, number> };

/** Required skills weigh most, then preferred ones and title skills, then other keywords the posting names. */
export function buildJobTerms(job: JobContext): JobTerms {
  const weights = new Map<string, number>();
  const add = (raw: string, w: number) => {
    const k = canonicalSkill(raw.trim());
    if (k.length < 2) return;
    weights.set(k, Math.max(weights.get(k) ?? 0, w));
  };
  for (const s of job.requiredSkills) add(s, 1);
  for (const s of job.preferredSkills) add(s, 0.6);
  for (const s of extractSkills(job.jobTitle ?? "")) add(s, 0.6);
  for (const s of job.relevantKeywords) add(s, 0.3);
  for (const s of job.aiEnrichedSkills) add(s, 0.3);
  return { weights };
}

/** Every job term (canonical) regardless of weight; used by the keyword-stuffing guard. */
export const allJobTerms = (t: JobTerms): string[] => [...t.weights.keys()];

export type ScoreResult = { score: number; hits: string[] };

/**
 * Relevance 0..1 of a piece of text (plus the technologies of the entry it sits in, which count at half weight).
 * Transparent on purpose: the sum of the weights of the job terms the text evidences, scaled so that one required
 * skill is already 0.67 and two are 1.
 */
export function scoreText(text: string, entryTech: string[], terms: JobTerms): ScoreResult {
  const own = probe(text);
  const techProbe = probe(entryTech.join(" , "));
  let sum = 0;
  const hits: string[] = [];
  for (const [term, w] of terms.weights) {
    if (probeMentions(own, term)) {
      sum += w;
      hits.push(term);
    } else if (entryTech.length > 0 && (entryTech.some((t) => canonicalSkill(t) === term) || probeMentions(techProbe, term))) {
      sum += 0.5 * w;
    }
  }
  const score = Math.max(0.05, Math.min(1, sum / 1.5));
  return { score: Math.round(score * 100) / 100, hits };
}
