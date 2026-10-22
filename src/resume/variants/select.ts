import type { JobContext, MatchReport } from "@/job/schema";
import { canonicalSkill, extractSkills } from "@/job/skills";
import type { ResumeVariant } from "../schema";
import type { SelectVariantFn } from "../contracts";
import { probe, probeMentions, tokenize } from "../tailor/terms";

export type VariantScore = { variantId: string; score: number; titleHits: number };

/** Transparent scoring: title phrase hit 3, requirement/keyword overlap 1, description skill 0.25, matched required skill 0.5. */
export function scoreVariant(variant: ResumeVariant, job: JobContext, match: MatchReport | null): VariantScore {
  const title = job.jobTitle ?? "";
  const titleProbe = probe(title);
  const posting = new Set([...job.requiredSkills, ...job.preferredSkills, ...job.relevantKeywords, ...job.aiEnrichedSkills].map(canonicalSkill));
  const description = new Set(extractSkills(job.descriptionText.slice(0, 4000)).map(canonicalSkill));
  const matched = new Set([...(match?.matchedRequiredSkills ?? [])].map(canonicalSkill));
  let score = 0;
  let titleHits = 0;
  for (const kw of new Set(variant.roleKeywords.filter((k) => tokenize(k).length > 0))) {
    const canon = canonicalSkill(kw);
    if (probeMentions(titleProbe, kw)) {
      score += 3;
      titleHits++;
    }
    if (posting.has(canon)) score += 1;
    else if (description.has(canon)) score += 0.25;
    if (matched.has(canon)) score += 0.5;
  }
  return { variantId: variant.variantId, score, titleHits };
}

/**
 * SPEC 7.2: the user's choice always wins (a per-run override or the saved default). Otherwise the best-scoring variant
 * is picked. Ties break on the number of title hits, then on variantId ascending, so the result never depends on the
 * order the store happened to list the variants in.
 */
export const selectVariant: SelectVariantFn = (variants, job, match, preferredId) => {
  if (variants.length === 0) throw new Error("No resume variants exist");
  if (preferredId) {
    const chosen = variants.find((v) => v.variantId === preferredId);
    if (chosen) return { variant: chosen, auto: false };
  }
  const ranked = variants
    .map((v) => ({ v, s: scoreVariant(v, job, match) }))
    .sort((a, b) => b.s.score - a.s.score || b.s.titleHits - a.s.titleHits || a.v.variantId.localeCompare(b.v.variantId));
  return { variant: ranked[0]!.v, auto: true };
};
