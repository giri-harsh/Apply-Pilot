import { AIError, isFallbackEligible, isRetriable, type AIErrorKind } from "./errors";
import type { AIProvider, AIRequestRecord, StructuredRequest, StructuredResult } from "./types";

export type RouterDeps = {
  providers: AIProvider[]; // in preference order
  maxAttemptsPerProvider: number;
  baseDelayMs: number;
  /** Network attempts still allowed for this run (SPEC 21.2). Mutated as attempts are spent. */
  budget: { remaining: number };
  record: (r: AIRequestRecord) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type RouterOutcome<T> = { ok: true; result: StructuredResult<T>; attempts: number } | { ok: false; error: AIError; attempts: number };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Primary -> (rate_limit | quota only) -> secondary, once. Transient errors get a bounded retry on the
 * same provider. No loops: total attempts are capped by the per-provider budget and the per-run budget.
 * Every provider's output is validated by the request's own Zod schema, so a fallback result is held to
 * exactly the same contract as the primary's.
 */
export async function runStructured<T>(req: StructuredRequest<T>, deps: RouterDeps): Promise<RouterOutcome<T>> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  let attempts = 0;
  let lastError = new AIError("unknown", "no_provider");

  for (let p = 0; p < deps.providers.length; p++) {
    const provider = deps.providers[p]!;
    let providerFailureKind: AIErrorKind | null = null;
    for (let attempt = 0; attempt < deps.maxAttemptsPerProvider; attempt++) {
      if (deps.budget.remaining <= 0) {
        lastError = new AIError("limit", "run_request_limit");
        return { ok: false, error: lastError, attempts };
      }
      deps.budget.remaining--;
      attempts++;
      const started = now();
      try {
        const result = await provider.generateStructuredOutput(req);
        await deps.record({
          at: started, provider: provider.id, model: provider.model, category: req.category,
          inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
          latencyMs: now() - started, outcome: "ok",
        });
        return { ok: true, result, attempts };
      } catch (e) {
        const err = e instanceof AIError ? e : new AIError("unknown", "unexpected");
        lastError = err;
        providerFailureKind = err.kind;
        await deps.record({
          at: started, provider: provider.id, model: provider.model, category: req.category,
          latencyMs: now() - started, outcome: err.kind, errorCode: err.code,
        });
        if (!isRetriable(err.kind) || attempt + 1 >= deps.maxAttemptsPerProvider) break;
        await sleep(deps.baseDelayMs * 2 ** attempt);
      }
    }
    // Switch providers only for rate limit / quota. Auth or schema failures on one provider are not fixed by another.
    if (!(providerFailureKind && isFallbackEligible(providerFailureKind))) break;
  }
  return { ok: false, error: lastError, attempts };
}
