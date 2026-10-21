import { hashString } from "@/ai/classify/prompt";
import type { AIConfig } from "@/ai/config";
import { runStructured, type RouterDeps } from "@/ai/router";
import { appendUsage, type KVStore } from "@/ai/storage";
import type { AIProvider, AIRequestCategory } from "@/ai/types";
import type { JobContext } from "@/job/schema";
import type { UserProfile } from "@/shared/profile";
import { buildEvidence, type EvidenceBundle } from "./evidence";
import { validateGrounding, type Violation } from "./grounding";
import { DEFAULT_LIMIT, measure, type LengthLimit } from "./limits";
import {
  ANSWER_JSON_SCHEMA,
  AnswerEnvelopeSchema,
  AnswerItemSchema,
  RULES_VERSION,
  buildAnswerPrompt,
  regenerationNote,
  shortenNote,
  type AnswerItem,
  type PromptQuestion,
} from "./prompt";
import { REFUSAL_REASONS, type GenerateCategory } from "./questions";
import { answerCacheKey, findReusable, listAnswers, loadAnswerCache, questionSignature, saveAnswerCache } from "./storage";

export type AnswerQuestion = {
  fieldId: string;
  /** Short id used inside the prompt, e.g. "q1". */
  questionId: string;
  label: string;
  category: GenerateCategory;
  technologies: string[];
  limit: LengthLimit | null;
};

export type AnswerResult =
  | {
      fieldId: string;
      status: "ok";
      text: string;
      evidenceIds: string[];
      evidenceNames: string[];
      category: GenerateCategory;
      source: "generated" | "memory" | "cache";
      questionText: string;
      signature: string;
    }
  | { fieldId: string; status: "unresolved"; reason: string; violations: Violation[] };

export type GenerateDeps = {
  config: AIConfig;
  store: KVStore;
  providers: AIProvider[];
  budget: { remaining: number };
  profile: UserProfile;
  job: JobContext | null;
  memoryEnabled: boolean;
  now?: () => number;
  sleep?: RouterDeps["sleep"];
};

export type GenerateStats = { requests: number; cacheHits: number; memoryHits: number; regenerations: number; shortenings: number; provider: string | null; error: string | null };

const REFUSAL_TEXT: Record<string, string> = {
  insufficient_evidence: "Not enough recorded evidence to answer honestly; add details to your profile or write it yourself",
  sensitive: REFUSAL_REASONS.sensitive_demographic,
  unknown_personal_fact: REFUSAL_REASONS.unknown_personal_fact,
  legal: REFUSAL_REASONS.legal_declaration,
  eligibility: REFUSAL_REASONS.eligibility,
  binding: REFUSAL_REASONS.binding_agreement,
};

function jobHash(job: JobContext | null): string {
  if (!job) return "nojob";
  return hashString([job.company, job.jobTitle, [...job.requiredSkills].sort().join(","), job.descriptionText.slice(0, 500)].join("|"));
}

/**
 * Evidence-grounded answer generation (SPEC 14, 13.3, 13.4, 19.3). Order: approved memory, cache, one batched
 * request, then at most one regeneration (listing the exact violations) and one shortening. Nothing the grounding
 * validator or the length check rejects is ever returned as an answer.
 */
export async function generateAnswers(questions: AnswerQuestion[], deps: GenerateDeps): Promise<{ results: AnswerResult[]; stats: GenerateStats }> {
  const { config, store, providers, profile, job } = deps;
  const now = deps.now ?? Date.now;
  const stats: GenerateStats = { requests: 0, cacheHits: 0, memoryHits: 0, regenerations: 0, shortenings: 0, provider: null, error: null };
  const results = new Map<string, AnswerResult>();
  if (questions.length === 0) return { results: [], stats };

  const bundle: EvidenceBundle = buildEvidence(profile, job, questions.map((q) => ({ id: q.questionId, category: q.category, text: q.label, technologies: q.technologies })));
  const eff = (q: AnswerQuestion): LengthLimit => q.limit ?? DEFAULT_LIMIT;
  const sentIds = (q: AnswerQuestion) => bundle.perQuestion.get(q.questionId) ?? [];
  const names = (ids: string[]) => ids.map((id) => bundle.items.get(id)?.title).filter((t): t is string => Boolean(t));
  const sig = (q: AnswerQuestion) => questionSignature(q.category, q.label);
  const evHash = (q: AnswerQuestion) => hashString(sentIds(q).map((id) => id + bundle.items.get(id)!.text).join("\n"));
  const jh = jobHash(job);

  const check = (q: AnswerQuestion, text: string, evidenceIds: string[], claims: AnswerItem["claims"]) => {
    const violations = validateGrounding({ answer: text, evidenceIds, claims, sentIds: sentIds(q), bundle, questionText: q.label });
    const limit = eff(q);
    const actual = measure(text, limit.unit);
    return { violations, over: actual > limit.max ? { actual, limit } : null };
  };
  const accept = (q: AnswerQuestion, text: string, evidenceIds: string[], source: "generated" | "memory" | "cache") => {
    results.set(q.fieldId, { fieldId: q.fieldId, status: "ok", text: text.trim(), evidenceIds, evidenceNames: names(evidenceIds), category: q.category, source, questionText: q.label, signature: sig(q) });
  };
  const reject = (q: AnswerQuestion, reason: string, violations: Violation[] = []) => {
    results.set(q.fieldId, { fieldId: q.fieldId, status: "unresolved", reason, violations });
  };

  // ---- A. approved memory, then cache: zero network ----
  const cache = await loadAnswerCache(store);
  const saved = deps.memoryEnabled ? await listAnswers(store) : [];
  const todo: AnswerQuestion[] = [];
  for (const q of questions) {
    const ids = sentIds(q);
    const reusable = deps.memoryEnabled ? findReusable(saved, q.category, sig(q), { company: job?.company ?? null, title: job?.jobTitle ?? null }) : null;
    if (reusable && ids.length > 0) {
      const c = check(q, reusable.text, ids, []);
      if (c.violations.length === 0 && !c.over) {
        stats.memoryHits++;
        accept(q, reusable.text, ids, "memory");
        continue;
      }
    }
    let hit = false;
    for (const p of providers) {
      const e = cache[answerCacheKey({ signature: sig(q), jobHash: jh, evidenceHash: evHash(q), provider: p.id, model: p.model, rules: RULES_VERSION })];
      if (!e || now() - e.at > config.cache.ttlMs) continue;
      const c = check(q, e.text, e.evidenceIds.filter((x) => ids.includes(x)), []);
      if (c.violations.length === 0 && !c.over) {
        stats.cacheHits++;
        accept(q, e.text, e.evidenceIds, "cache");
        hit = true;
        break;
      }
    }
    if (!hit) todo.push(q);
  }
  if (todo.length === 0) return { results: questions.map((q) => results.get(q.fieldId)!), stats };

  const routerDeps = (): RouterDeps => ({
    providers,
    maxAttemptsPerProvider: config.retry.maxAttemptsPerProvider,
    baseDelayMs: config.retry.baseDelayMs,
    budget: deps.budget,
    sleep: deps.sleep,
    now,
    record: (r) => appendUsage(store, r, config.usage.maxRecords),
  });

  /** One batched, schema-validated request. Returns parsed items by question id, or an error kind. */
  const ask = async (category: AIRequestCategory, qs: AnswerQuestion[], extra?: string) => {
    const pq: PromptQuestion[] = qs.map((q) => ({ id: q.questionId, category: q.category, text: q.label, limit: eff(q) }));
    const prompt = buildAnswerPrompt(pq, bundle, job, extra);
    const before = deps.budget.remaining;
    const out = await runStructured(
      { category, system: prompt.system, user: prompt.user, schema: AnswerEnvelopeSchema, jsonSchema: ANSWER_JSON_SCHEMA, schemaName: "application_answers", maxOutputTokens: 2500 },
      routerDeps(),
    );
    stats.requests += before - deps.budget.remaining;
    if (!out.ok) return { error: out.error, items: new Map<string, AnswerItem>(), answered: null as AIProvider | null };
    stats.provider = out.result.provider;
    const items = new Map<string, AnswerItem>();
    for (const raw of out.result.data.answers) {
      const p = AnswerItemSchema.safeParse(raw);
      if (p.success && !items.has(p.data.questionId)) items.set(p.data.questionId, p.data);
    }
    return { error: null, items, answered: providers.find((p) => p.id === out.result.provider) ?? null };
  };

  const unavailable = (qs: AnswerQuestion[], kind: string) => {
    stats.error = kind;
    for (const q of qs) if (!results.has(q.fieldId)) reject(q, `AI unavailable (${kind}); not generated`);
  };

  // ---- B. one batched request ----
  const first = await ask("answer_generation", todo);
  let answeredBy = first.answered;
  if (first.error) {
    unavailable(todo, first.error.kind);
    return { results: questions.map((q) => results.get(q.fieldId)!), stats };
  }

  const needRegen: { q: AnswerQuestion; v: Violation[] }[] = [];
  const needShorten: { q: AnswerQuestion; item: AnswerItem }[] = [];
  const evaluate = (q: AnswerQuestion, item: AnswerItem | undefined, phase: "first" | "regen"): void => {
    if (!item) return void reject(q, "The model returned no answer for this question");
    if (item.refusal !== "none") return void reject(q, REFUSAL_TEXT[item.refusal] ?? "Not generated");
    const c = check(q, item.answer, item.evidenceIds, item.claims);
    if (c.violations.length > 0) {
      if (phase === "first") needRegen.push({ q, v: c.violations });
      else reject(q, `Ungrounded answer rejected: ${c.violations.map((x) => x.rule).join(", ")}`, c.violations);
      return;
    }
    if (c.over) {
      needShorten.push({ q, item });
      return;
    }
    accept(q, item.answer, item.evidenceIds, "generated");
  };
  for (const q of todo) evaluate(q, first.items.get(q.questionId), "first");

  // ---- C. at most one regeneration, with the exact violations listed ----
  if (needRegen.length > 0) {
    const qs = needRegen.map((x) => x.q);
    stats.regenerations++;
    const note = regenerationNote(Object.fromEntries(needRegen.map((x) => [x.q.questionId, x.v.map((v) => v.detail)])));
    const second = await ask("answer_regeneration", qs, note);
    answeredBy = second.answered ?? answeredBy;
    if (second.error) {
      stats.error = second.error.kind;
      for (const x of needRegen) reject(x.q, `Ungrounded answer rejected: ${x.v.map((v) => v.rule).join(", ")}`, x.v);
    } else {
      for (const x of needRegen) evaluate(x.q, second.items.get(x.q.questionId), "regen");
    }
  }

  // ---- D. at most one shortening; never truncate ----
  if (needShorten.length > 0) {
    stats.shortenings++;
    const note = shortenNote(needShorten.map(({ q, item }) => ({ id: q.questionId, previous: item.answer, limit: eff(q), actual: measure(item.answer, eff(q).unit) })));
    const third = await ask("answer_shortening", needShorten.map((x) => x.q), note);
    answeredBy = third.answered ?? answeredBy;
    for (const { q, item } of needShorten) {
      const short = third.items.get(q.questionId);
      const limit = eff(q);
      if (third.error || !short || short.refusal !== "none") {
        reject(q, `Over the length limit (${measure(item.answer, limit.unit)} ${limit.unit}, maximum ${limit.max}); not shortened`);
        continue;
      }
      const c = check(q, short.answer, short.evidenceIds, short.claims);
      if (c.violations.length > 0) reject(q, `Ungrounded answer rejected: ${c.violations.map((x) => x.rule).join(", ")}`, c.violations);
      else if (c.over) reject(q, `Still over the length limit (${c.over.actual} ${limit.unit}, maximum ${limit.max})`);
      else accept(q, short.answer, short.evidenceIds, "generated");
    }
  }

  // ---- cache what was generated and accepted ----
  if (answeredBy) {
    const next = { ...cache };
    for (const q of todo) {
      const r = results.get(q.fieldId);
      if (r?.status === "ok" && r.source === "generated") {
        next[answerCacheKey({ signature: sig(q), jobHash: jh, evidenceHash: evHash(q), provider: answeredBy.id, model: answeredBy.model, rules: RULES_VERSION })] = { text: r.text, evidenceIds: r.evidenceIds, at: now() };
      }
    }
    await saveAnswerCache(store, next);
  }
  return { results: questions.map((q) => results.get(q.fieldId)!), stats };
}
