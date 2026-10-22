import type { MatchReport } from "@/job/schema";
import type { MasterResume } from "../schema";
import { entryTechnologies } from "./evidence-from-master";
import { scoreText, type JobTerms } from "./terms";

export type Relevance = {
  fact: Map<string, number>;
  entry: Map<string, number>;
  /** Job terms each fact states in its own text. */
  hits: Map<string, string[]>;
};

/**
 * SPEC 7.4 steps 3-4: relevance 0..1 for every master fact and entry against the job. Deterministic and explainable:
 * the weights of the job's required / preferred / keyword terms a line evidences (see `scoreText`). Phase 5's match is
 * a small tie-breaking boost for entries that mirror a profile record it ranked.
 */
export function computeRelevance(master: MasterResume, terms: JobTerms, match: MatchReport | null): Relevance {
  const fact = new Map<string, number>();
  const entry = new Map<string, number>();
  const hits = new Map<string, string[]>();
  const ranked = new Map<string, number>([...(match?.projects ?? []), ...(match?.experience ?? [])].map((r) => [r.id, r.score]));

  for (const e of master.entries) {
    const tech = entryTechnologies(e);
    let best = 0;
    for (const b of e.bullets) {
      const r = scoreText(b.text, tech, terms);
      fact.set(b.factId, r.score);
      hits.set(b.factId, r.hits);
      best = Math.max(best, r.score);
    }
    const own = scoreText(`${e.heading.text} ${e.subheading?.text ?? ""}`, tech, terms);
    fact.set(e.heading.factId, own.score);
    if (e.subheading) fact.set(e.subheading.factId, own.score);
    let s = Math.max(best, own.score);
    if (e.section === "education") s = Math.max(s, 0.6);
    const boost = e.profileRecordId ? 0.1 * (ranked.get(e.profileRecordId) ?? 0) : 0;
    s = Math.min(1, s + boost);
    entry.set(e.entryId, Math.round(s * 100) / 100);
    fact.set(e.heading.factId, entry.get(e.entryId)!);
    if (e.subheading) fact.set(e.subheading.factId, entry.get(e.entryId)!);
  }
  for (const g of master.skillGroups) {
    for (const it of g.items) {
      const r = scoreText(it.text, [], terms);
      fact.set(it.factId, r.score);
      hits.set(it.factId, r.hits);
    }
  }
  for (const a of master.achievements) {
    const r = scoreText(a.text, [], terms);
    fact.set(a.factId, Math.max(0.3, r.score));
    hits.set(a.factId, r.hits);
  }
  if (master.summary) fact.set(master.summary.factId, 0.5);
  return { fact, entry, hits };
}
