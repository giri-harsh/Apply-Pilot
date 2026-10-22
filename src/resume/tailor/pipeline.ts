import { rankAgainstProfile } from "@/job/rank";
import type { MatchReport } from "@/job/schema";
import { canonicalSkill } from "@/job/skills";
import type { TailorFn, TailorInput, TailorOutput } from "../contracts";
import { assertMasterUnchanged, hashMaster } from "../hash";
import type { MasterResume } from "../schema";
import { applyVariant } from "../variants/apply";
import { aiUsable, newRun, type AiRun } from "./ai";
import { assemble } from "./assemble";
import { computeRelevance } from "./relevance";
import { MAX_REWRITES, rewriteBullets, type RewriteCandidate, type RewriteDecision } from "./rewrite";
import { allJobTerms, buildJobTerms, probe, probeMentions } from "./terms";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const shortHash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** A bullet is worth sending for rewording when it is long enough to say something and evidences at least one job term. */
const MIN_RELEVANCE = 0.2;
const MIN_CHARS = 25;

export type TailorRun = { output: TailorOutput; run: AiRun; decisions: Map<string, RewriteDecision> };

/**
 * SPEC 7.4. rank -> apply variant -> reorder -> (AI) reword -> ground-check -> assemble. The master is only ever read:
 * its hash is taken first and re-checked last, and nothing below mutates it (it may be deep-frozen).
 */
export async function tailorWithStats(input: TailorInput): Promise<TailorRun> {
  const { master, variant, job, ai, budget } = input;
  const now = (input.now ?? (() => new Date()))();
  const masterHash = await hashMaster(master);
  const warnings: string[] = [];
  const run = newRun();

  let match: MatchReport | null = input.match;
  if (!match) {
    try {
      match = rankAgainstProfile(job, input.profile);
    } catch {
      match = null;
    }
  }

  const terms = buildJobTerms(job);
  const rel = computeRelevance(master, terms, match);
  const selection = applyVariant(master, variant, { score: { fact: (id) => rel.fact.get(id) ?? 0, entry: (id) => rel.entry.get(id) ?? 0 }, fillUnlistedAtLeast: 0.5 });

  // ---- candidates: the most relevant bullets, capped ----
  const all: (RewriteCandidate & { order: number })[] = [];
  let order = 0;
  for (const section of ["experience", "projects", "education", "certifications"] as const) {
    for (const se of selection.entries[section]) {
      for (const bullet of se.bullets) {
        const relevance = rel.fact.get(bullet.factId) ?? 0;
        if (relevance >= MIN_RELEVANCE && bullet.text.length >= MIN_CHARS) all.push({ entry: se.entry, bullet, relevance, order: order++ });
      }
    }
  }
  const candidates = all.sort((a, b) => b.relevance - a.relevance || a.order - b.order).slice(0, MAX_REWRITES);

  let decisions = new Map<string, RewriteDecision>();
  if (candidates.length > 0) {
    const usable = aiUsable(ai, budget);
    if (!usable.ok) warnings.push(usable.why);
    else decisions = await rewriteBullets({ candidates, job, jobTerms: allJobTerms(terms), ai: usable.ai, budget, run, warnings });
  }

  const requiredTerms = [...new Set(job.requiredSkills.map(canonicalSkill))];
  const { tailored, modifiedSections } = assemble({
    master, variant, selection, rel, decisions, requiredTerms, masterHash,
    tailoredId: `tl_${masterHash.slice(0, 8)}_${now.getTime().toString(36)}_${shortHash(`${variant.variantId}|${job.jobTitle}|${job.jobUrl}`)}`,
    now,
  });

  // ---- requirements: evidenced by the master / not, and visible in this resume / not ----
  const masterProbe = probe(masterText(master));
  const shownProbe = probe(tailored.sections.flatMap((s) => s.entries.flatMap((e) => e.lines.map((l) => l.text))).join("\n"));
  const requirements = [...new Set([...job.requiredSkills, ...job.preferredSkills].map(canonicalSkill))];
  const matched = requirements.filter((r) => probeMentions(masterProbe, r));
  const unmatched = requirements.filter((r) => !probeMentions(masterProbe, r));
  for (const r of requiredTerms) {
    if (probeMentions(masterProbe, r) && !probeMentions(shownProbe, r)) warnings.push(clip(`The required skill "${r}" is in your master resume but not in this version (variant limits)`, 300));
  }

  const selectedFactIds = [...new Set(tailored.sections.flatMap((s) => s.entries.flatMap((e) => e.lines.flatMap((l) => l.sourceFactIds))))].slice(0, 600);

  const report: TailorOutput["report"] = {
    reportId: `rpt_${masterHash.slice(0, 8)}_${now.getTime().toString(36)}`,
    createdAt: now.toISOString(),
    masterId: master.masterId,
    masterHash,
    variantId: variant.variantId,
    // TailorInput does not say how the variant was chosen; the caller that ran selectVariant overwrites this.
    variantAutoSelected: false,
    job: { title: clip(job.jobTitle ?? "", 200), company: clip(job.company ?? "", 200), url: clip(job.jobUrl, 500) },
    matchedRequirements: matched.map((m) => clip(m, 80)).slice(0, 60),
    unmatchedRequirements: unmatched.map((m) => clip(m, 80)).slice(0, 60),
    selectedFactIds,
    modifiedSections,
    rewrites: candidates
      .map((c) => {
        const d = decisions.get(c.bullet.factId);
        return d ? { lineId: `l_${c.bullet.factId}`, status: d.status, violations: d.violations } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
    droppedLines: selection.dropped.slice(0, 200).map((d) => ({ lineId: `l_${d.factId}`, reason: clip(d.reason, 200) })),
    warnings: warnings.map((w) => clip(w, 300)).slice(0, 40),
    ai: { requests: run.requests, provider: run.provider },
  };

  await assertMasterUnchanged(master, masterHash);
  return { output: { tailored, report }, run, decisions };
}

function masterText(master: MasterResume): string {
  const parts: string[] = [master.summary?.text ?? ""];
  for (const e of master.entries) parts.push(e.heading.text, e.subheading?.text ?? "", ...e.bullets.map((b) => b.text), e.technologies.join(" , "));
  for (const g of master.skillGroups) parts.push(g.label, ...g.items.map((i) => i.text));
  parts.push(...master.achievements.map((a) => a.text));
  return parts.join("\n");
}

export const tailor: TailorFn = async (input) => (await tailorWithStats(input)).output;
