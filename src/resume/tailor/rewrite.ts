import type { AnswerClaim } from "@/answers/grounding";
import type { JobContext } from "@/job/schema";
import type { TailorAi } from "../contracts";
import type { Fact, MasterEntry } from "../schema";
import { ask, type AiRun } from "./ai";
import { allowedOrgsFor, bundleOf, entryTechnologies, itemForBullet, urlsIn } from "./evidence-from-master";
import { buildRewritePrompt, regenerationNote, REWRITE_JSON_SCHEMA, RewriteEnvelopeSchema, RewriteItemSchema, type PromptBullet, type PromptEntry, type RewriteItem } from "./prompt";
import { checkText, sameWording, violationStrings, type TailorViolation } from "./rules";

export type RewriteCandidate = { entry: MasterEntry; bullet: Fact; relevance: number };
export type RewriteDecision = { status: "accepted" | "fallback_to_master" | "kept_master"; text: string; violations: string[]; evidenceFactIds: string[] };

/** Bullets are reworded with a length allowance of 15% over the master wording. */
export const GROWTH = 1.15;
export const MAX_REWRITES = 12;

export const cleanLine = (s: string): string => s.replace(/^[\s•*–-]+/, "").replace(/\s+/g, " ").trim();

type Ctx = { alias: string; c: RewriteCandidate; maxChars: number; check: (item: RewriteItem) => TailorViolation[] };

/**
 * ONE batched request for all candidate bullets, per-bullet grounding, then at most ONE regeneration for the bullets
 * that violated a rule (the exact violations are listed). A bullet that still fails keeps the ORIGINAL master wording
 * and the violations go to the report; nothing is dropped and nothing ungrounded is ever returned as accepted.
 */
export async function rewriteBullets(args: {
  candidates: RewriteCandidate[];
  job: JobContext;
  jobTerms: string[];
  ai: NonNullable<TailorAi>;
  budget: { remaining: number };
  run: AiRun;
  warnings: string[];
}): Promise<Map<string, RewriteDecision>> {
  const { candidates, job, ai, budget, run, warnings } = args;
  const decisions = new Map<string, RewriteDecision>();
  if (candidates.length === 0) return decisions;

  const entryAlias = new Map<string, string>();
  const entries: PromptEntry[] = [];
  const ctxs: Ctx[] = candidates.map((c, i) => {
    const alias = `b${i + 1}`;
    if (!entryAlias.has(c.entry.entryId)) {
      entryAlias.set(c.entry.entryId, `e${entryAlias.size + 1}`);
      entries.push({ id: entryAlias.get(c.entry.entryId)!, heading: c.entry.heading.text, technologies: c.entry.technologies });
    }
    const item = itemForBullet(alias, c.entry, c.bullet);
    const bundle = bundleOf([item], allowedOrgsFor(c.entry, [c.bullet.text]), [...c.entry.links.map((l) => l.url), ...urlsIn(c.bullet.text)]);
    const maxChars = Math.floor(c.bullet.text.length * GROWTH);
    return {
      alias, c, maxChars,
      check: (it) =>
        checkText({
          text: it.text, claims: it.claims as AnswerClaim[], cited: it.evidenceFactIds, ownId: alias, sentIds: [alias], bundle,
          sourceText: c.bullet.text, entryTech: entryTechnologies(c.entry), jobTerms: args.jobTerms, maxChars,
        }),
    };
  });
  const byAlias = new Map(ctxs.map((x) => [x.alias, x]));
  const promptBullets = (cs: Ctx[]): PromptBullet[] => cs.map((x) => ({ lineId: x.alias, entry: entryAlias.get(x.c.entry.entryId)!, text: x.c.bullet.text, maxChars: x.maxChars }));

  const send = async (cs: Ctx[], extra?: string): Promise<{ ok: true; items: Map<string, RewriteItem> } | { ok: false; kind: string }> => {
    const prompt = buildRewritePrompt(job, entries.filter((e) => cs.some((x) => entryAlias.get(x.c.entry.entryId) === e.id)), promptBullets(cs), extra);
    const out = await ask(ai, budget, run, { category: "resume_rewrite", system: prompt.system, user: prompt.user, schema: RewriteEnvelopeSchema, jsonSchema: REWRITE_JSON_SCHEMA, schemaName: "resume_rewrites", maxOutputTokens: 4500 });
    if (!out.ok) return out;
    const items = new Map<string, RewriteItem>();
    for (const raw of out.data.items) {
      const p = RewriteItemSchema.safeParse(raw);
      if (p.success && byAlias.has(p.data.lineId) && !items.has(p.data.lineId)) items.set(p.data.lineId, p.data);
    }
    return { ok: true, items };
  };

  const fallbackAll = (why: string) => {
    for (const x of ctxs) decisions.set(x.c.bullet.factId, { status: "fallback_to_master", text: x.c.bullet.text, violations: [why], evidenceFactIds: [x.c.bullet.factId] });
  };

  const first = await send(ctxs);
  if (!first.ok) {
    if (first.kind === "invalid_response") {
      warnings.push("The AI response could not be used (invalid format); every bullet keeps your own wording");
      fallbackAll("invalid_response: the model output did not match the required format");
    } else {
      warnings.push(`The AI request failed (${first.kind}); every bullet keeps your own wording`);
      fallbackAll(`ai_unavailable: ${first.kind}`);
    }
    return decisions;
  }

  const retry: { x: Ctx; v: TailorViolation[] }[] = [];
  const evaluate = (x: Ctx, item: RewriteItem | undefined, phase: "first" | "regen", prior: TailorViolation[] = []) => {
    const master = x.c.bullet.text;
    let v: TailorViolation[];
    if (!item) {
      v = [{ rule: "missing_item", detail: "The model returned no rewrite for this bullet" }];
    } else {
      const text = cleanLine(item.text);
      if (sameWording(text, master)) return void decisions.set(x.c.bullet.factId, { status: "kept_master", text: master, violations: [], evidenceFactIds: [x.c.bullet.factId] });
      v = x.check({ ...item, text });
      if (v.length === 0) {
        decisions.set(x.c.bullet.factId, { status: "accepted", text, violations: [], evidenceFactIds: [x.c.bullet.factId, x.c.entry.heading.factId] });
        return;
      }
    }
    if (phase === "first") retry.push({ x, v });
    else decisions.set(x.c.bullet.factId, { status: "fallback_to_master", text: master, violations: violationStrings(item ? v : prior), evidenceFactIds: [x.c.bullet.factId] });
  };
  for (const x of ctxs) evaluate(x, first.items.get(x.alias), "first");

  if (retry.length > 0 && budget.remaining > 0) {
    const note = regenerationNote(Object.fromEntries(retry.map((r) => [r.x.alias, violationStrings(r.v)])));
    const second = await send(retry.map((r) => r.x), note);
    for (const r of retry) {
      if (!second.ok) {
        decisions.set(r.x.c.bullet.factId, { status: "fallback_to_master", text: r.x.c.bullet.text, violations: violationStrings(r.v), evidenceFactIds: [r.x.c.bullet.factId] });
      } else {
        evaluate(r.x, second.items.get(r.x.alias), "regen", r.v);
      }
    }
    if (!second.ok) warnings.push(`The regeneration request failed (${second.kind}); the affected bullets keep your own wording`);
  } else {
    for (const r of retry) decisions.set(r.x.c.bullet.factId, { status: "fallback_to_master", text: r.x.c.bullet.text, violations: violationStrings(r.v), evidenceFactIds: [r.x.c.bullet.factId] });
    if (retry.length > 0) warnings.push("The AI request budget ran out before the rejected bullets could be regenerated; they keep your own wording");
  }
  return decisions;
}
