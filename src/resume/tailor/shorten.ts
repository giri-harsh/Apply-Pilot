import type { AnswerClaim } from "@/answers/grounding";
import type { MakeShortenFn, ShortenFn } from "../contracts";
import type { TailoredLine } from "../schema";
import { ask, aiUsable, newRun, type AiRun } from "./ai";
import { allowedOrgsFor, bundleOf, entryTechnologies, indexMaster, itemForBullet, itemForPlainFacts, urlsIn } from "./evidence-from-master";
import { buildShortenPrompt, REWRITE_JSON_SCHEMA, RewriteEnvelopeSchema, RewriteItemSchema, type RewriteItem } from "./prompt";
import { checkText, sameWording } from "./rules";
import { cleanLine } from "./rewrite";
import { allJobTerms, buildJobTerms } from "./terms";

const MAX_LINES = 20;
const SHORTENABLE = new Set<TailoredLine["role"]>(["bullet", "paragraph"]);

/**
 * The fit loop's ShortenFn (B2 calls it). ONE request per call, no regeneration. Every replacement must be strictly
 * shorter than the line it replaces and pass the same grounding checks as a rewrite, judged against the MASTER facts
 * the line cites. Anything invalid, ungrounded or not shorter is discarded and the original line is returned as is.
 * The result always has the same length and order as the input.
 */
export const makeShorten: MakeShortenFn = (input) => makeShortenTracked(input).fn;

/** Same as `makeShorten`, also exposing what the calls spent (request count, provider, latency, tokens; no content). */
export function makeShortenTracked({ master, job, ai, budget }: Parameters<MakeShortenFn>[0]): { fn: ShortenFn; run: AiRun } {
  const idx = indexMaster(master);
  const jobTerms = allJobTerms(buildJobTerms(job));
  const run: AiRun = newRun();

  const fn: ShortenFn = async (lines, target) => {
    const usable = aiUsable(ai, budget);
    if (!usable.ok) return lines;

    type Plan = { alias: string; line: TailoredLine; check: (it: RewriteItem) => ReturnType<typeof checkText>; masterText: string };
    const plans: Plan[] = [];
    for (const line of lines) {
      if (plans.length >= MAX_LINES) break;
      if (!SHORTENABLE.has(line.role) || line.text.length < 30) continue;
      const ref = line.sourceFactIds.map((id) => idx.byFact.get(id)).find((r) => r && (r.kind === "bullet" || r.kind === "achievement"));
      if (!ref) continue;
      const alias = `s${plans.length + 1}`;
      const item = ref.entry ? itemForBullet(alias, ref.entry, ref.fact) : itemForPlainFacts(alias, "education", "Achievement", [ref.fact]);
      const bundle = bundleOf([item], allowedOrgsFor(ref.entry, [ref.fact.text]), [...(ref.entry?.links.map((l) => l.url) ?? []), ...urlsIn(ref.fact.text)]);
      plans.push({
        alias, line, masterText: ref.fact.text,
        check: (it) =>
          checkText({
            text: it.text, claims: it.claims as AnswerClaim[], cited: it.evidenceFactIds, ownId: alias, sentIds: [alias], bundle,
            sourceText: ref.fact.text, entryTech: ref.entry ? entryTechnologies(ref.entry) : [], jobTerms, shorterThan: line.text.length, maxChars: line.text.length - 1,
          }),
      });
    }
    if (plans.length === 0) return lines;

    const prompt = buildShortenPrompt(job, plans.map((p) => ({ lineId: p.alias, text: p.line.text, maxChars: p.line.text.length - 1 })), target);
    const out = await ask(usable.ai, budget, run, { category: "resume_shortening", system: prompt.system, user: prompt.user, schema: RewriteEnvelopeSchema, jsonSchema: REWRITE_JSON_SCHEMA, schemaName: "resume_shortenings", maxOutputTokens: 4500 });
    if (!out.ok) return lines;

    const replaced = new Map<string, TailoredLine>();
    const byAlias = new Map(plans.map((p) => [p.alias, p]));
    const seen = new Set<string>();
    for (const raw of out.data.items) {
      const parsed = RewriteItemSchema.safeParse(raw);
      if (!parsed.success || seen.has(parsed.data.lineId)) continue;
      const plan = byAlias.get(parsed.data.lineId);
      if (!plan) continue;
      seen.add(plan.alias);
      const text = cleanLine(parsed.data.text);
      if (text.length === 0 || sameWording(text, plan.line.text)) continue;
      if (plan.check({ ...parsed.data, text }).length > 0) continue;
      const { masterText: _drop, ...rest } = plan.line;
      void _drop;
      const rewritten = !sameWording(text, plan.masterText);
      replaced.set(plan.line.lineId, { ...rest, text, origin: rewritten ? "rewritten" : "master", ...(rewritten ? { masterText: plan.masterText } : {}) });
    }
    return lines.map((l) => replaced.get(l.lineId) ?? l);
  };
  return { fn, run };
}
