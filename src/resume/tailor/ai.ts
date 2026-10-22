import type { ZodType } from "zod";
import { runStructured } from "@/ai/router";
import { appendUsage } from "@/ai/storage";
import type { AIRequestCategory, JsonSchema } from "@/ai/types";
import type { TailorAi } from "../contracts";

/** What one tailoring / shortening / cover-letter call spent. Never contains prompts, responses or keys. */
export type AiRun = {
  requests: number;
  provider: string | null;
  model: string | null;
  error: string | null;
  /** Safe short code of the last failure (e.g. "http_400") and the provider's own diagnostic text for 400/404, if any. */
  errorCode: string | null;
  errorDetail: string | null;
  calls: { category: AIRequestCategory; ok: boolean; latencyMs: number; inputTokens?: number; outputTokens?: number }[];
};

export const newRun = (): AiRun => ({ requests: 0, provider: null, model: null, error: null, errorCode: null, errorDetail: null, calls: [] });

export type Asked<T> = { ok: true; data: T } | { ok: false; kind: string };

/**
 * One structured request through the existing router. No retry loop of our own and no per-provider retry
 * (`maxAttemptsPerProvider: 1`), so a request is exactly one network attempt and the per-run cap is easy to state:
 * one rewrite plus at most one regeneration. An unusable response (bad JSON, schema mismatch) is `invalid_response`.
 */
export async function ask<T>(
  ai: NonNullable<TailorAi>,
  budget: { remaining: number },
  run: AiRun,
  req: { category: AIRequestCategory; system: string; user: string; schema: ZodType<T>; jsonSchema: JsonSchema; schemaName: string; maxOutputTokens: number },
): Promise<Asked<T>> {
  const before = budget.remaining;
  const out = await runStructured(req, {
    providers: ai.providers,
    maxAttemptsPerProvider: 1,
    baseDelayMs: ai.config.retry.baseDelayMs,
    budget,
    sleep: ai.sleep,
    record: (r) => appendUsage(ai.store, r, ai.config.usage.maxRecords),
  });
  run.requests += before - budget.remaining;
  if (!out.ok) {
    run.error = out.error.kind;
    run.errorCode = out.error.code;
    run.errorDetail = out.error.detail ?? null;
    run.calls.push({ category: req.category, ok: false, latencyMs: 0 });
    return { ok: false, kind: out.error.kind };
  }
  run.provider = out.result.provider;
  run.model = out.result.model;
  run.calls.push({ category: req.category, ok: true, latencyMs: out.result.latencyMs, inputTokens: out.result.usage.inputTokens, outputTokens: out.result.usage.outputTokens });
  return { ok: true, data: out.result.data };
}

/** AI can be used only when it is configured, has a provider, and the shared budget has a request left. */
export function aiUsable(ai: TailorAi, budget: { remaining: number }): { ok: true; ai: NonNullable<TailorAi> } | { ok: false; why: string } {
  if (!ai) return { ok: false, why: "AI is off or not configured; every line keeps your own wording" };
  if (ai.providers.length === 0) return { ok: false, why: "No AI provider is available; every line keeps your own wording" };
  if (budget.remaining <= 0) return { ok: false, why: "The AI request budget for this run is used up; every line keeps your own wording" };
  return { ok: true, ai };
}
