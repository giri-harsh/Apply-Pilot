import { z } from "zod";
import type { KVStore } from "@/ai/storage";
import { hashString } from "@/ai/classify/prompt";
import type { GenerateCategory } from "./questions";

/** SPEC 19.3: approved reusable answers, saved only on an explicit click, in their own namespace. */
export const ANSWER_MEMORY_KEY = "applypilot.answers.v1";
/** SPEC 13.4: generated answers cached by question + job + evidence + model + rules version. */
export const ANSWER_CACHE_KEY = "applypilot.ai.answercache.v1";

export const SavedAnswerSchema = z.object({
  id: z.string().min(1).max(40),
  category: z.string().max(40),
  questionSignature: z.string().max(200),
  questionText: z.string().max(300),
  text: z.string().max(4000),
  evidence: z.array(z.string().max(200)).max(10),
  job: z.object({ company: z.string().max(200).nullable(), title: z.string().max(200).nullable() }),
  savedAt: z.number(),
});
export type SavedAnswer = z.infer<typeof SavedAnswerSchema>;

const MemorySchema = z.array(SavedAnswerSchema).max(200);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Same wording, same category: the signature of a question. Job-independent. */
export function questionSignature(category: GenerateCategory, questionText: string): string {
  return `${category}:${hashString(norm(questionText))}`;
}

export async function listAnswers(store: KVStore): Promise<SavedAnswer[]> {
  const r = MemorySchema.safeParse((await store.get(ANSWER_MEMORY_KEY))[ANSWER_MEMORY_KEY] ?? []);
  return r.success ? r.data : [];
}

export async function saveAnswer(store: KVStore, a: Omit<SavedAnswer, "id" | "savedAt">, now = Date.now()): Promise<SavedAnswer> {
  const all = await listAnswers(store);
  // One approved answer per (signature, company): saving again replaces it.
  const rest = all.filter((x) => !(x.questionSignature === a.questionSignature && norm(x.job.company ?? "") === norm(a.job.company ?? "")));
  const saved: SavedAnswer = { ...a, id: `ans_${hashString(`${a.questionSignature}|${a.job.company}|${now}`)}`, savedAt: now };
  await store.set({ [ANSWER_MEMORY_KEY]: [...rest, saved].slice(-200) });
  return saved;
}

export async function deleteAnswer(store: KVStore, id: string): Promise<void> {
  await store.set({ [ANSWER_MEMORY_KEY]: (await listAnswers(store)).filter((a) => a.id !== id) });
}

export async function clearAnswers(store: KVStore): Promise<void> {
  await store.remove(ANSWER_MEMORY_KEY);
}

const JOB_SPECIFIC: GenerateCategory[] = ["why_join", "fit", "interest_role"];

const titleTokens = (t: string | null) => new Set(norm(t ?? "").split(" ").filter((w) => w.length > 2 && w !== "intern"));

/**
 * An approved answer is reusable when the question signature matches and the job context is compatible:
 * job-specific questions (why join, fit, interest) need the same company and a similar title; generic ones
 * (projects, strengths, challenges...) can travel between jobs. Otherwise the answer is regenerated.
 */
export function findReusable(all: SavedAnswer[], category: GenerateCategory, signature: string, job: { company: string | null; title: string | null }): SavedAnswer | null {
  const candidates = all.filter((a) => a.questionSignature === signature);
  if (JOB_SPECIFIC.includes(category)) {
    const sameCompany = (a: SavedAnswer) => norm(a.job.company ?? "") !== "" && norm(a.job.company ?? "") === norm(job.company ?? "");
    const similarTitle = (a: SavedAnswer) => {
      const x = titleTokens(a.job.title);
      const y = titleTokens(job.title);
      if (x.size === 0 || y.size === 0) return true;
      const common = [...x].filter((w) => y.has(w)).length;
      return common / Math.min(x.size, y.size) >= 0.5;
    };
    return candidates.find((a) => sameCompany(a) && similarTitle(a)) ?? null;
  }
  return candidates.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

// ---- generated-answer cache ----
const CachedAnswerSchema = z.object({ text: z.string(), evidenceIds: z.array(z.string()), at: z.number() });
type AnswerCache = Record<string, z.infer<typeof CachedAnswerSchema>>;

export async function loadAnswerCache(store: KVStore): Promise<AnswerCache> {
  const r = z.record(z.string(), CachedAnswerSchema).safeParse((await store.get(ANSWER_CACHE_KEY))[ANSWER_CACHE_KEY] ?? {});
  return r.success ? r.data : {};
}

export async function saveAnswerCache(store: KVStore, cache: AnswerCache, max = 100): Promise<void> {
  const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, max);
  await store.set({ [ANSWER_CACHE_KEY]: Object.fromEntries(entries) });
}

export async function clearAnswerCache(store: KVStore): Promise<void> {
  await store.remove(ANSWER_CACHE_KEY);
}

export function answerCacheKey(parts: { signature: string; jobHash: string; evidenceHash: string; provider: string; model: string; rules: string }): string {
  return [parts.signature, parts.jobHash, parts.evidenceHash, parts.provider, parts.model, parts.rules].join("|");
}
