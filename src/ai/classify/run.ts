import type { FormField } from "@/shared/form";
import type { AIConfig, ProviderId } from "../config";
import type { AIErrorKind } from "../errors";
import { runStructured, type RouterDeps } from "../router";
import { appendUsage, loadCache, saveCache, type KVStore, type MappingCache } from "../storage";
import type { AIProvider } from "../types";
import { buildPrompt, fieldSignature } from "./prompt";
import { AI_CLASSIFICATION_JSON_SCHEMA, AiEnvelopeSchema } from "./schema";
import { validateMappings, type AcceptedMapping, type Rejection } from "./validate";

export type ClassifyDeps = {
  config: AIConfig;
  store: KVStore;
  /** Providers that have keys, in the user's preferred order. */
  providers: AIProvider[];
  budget: { remaining: number };
  now?: () => number;
  sleep?: RouterDeps["sleep"];
};

export type ClassifyOutcome = {
  accepted: AcceptedMapping[];
  rejected: Rejection[];
  stats: {
    candidates: number;
    cacheHits: number;
    requests: number;
    dropped: number;
    provider: ProviderId | null;
    model: string | null;
    error: AIErrorKind | null;
  };
};

/** Rejections that are a stable property of the field, so repeating the request would only waste quota. */
const NEGATIVE_CACHEABLE = new Set<Rejection["reason"]>(["not_mapped", "disallowed_type", "key_mismatch", "sensitive_label", "malformed"]);

const cacheKey = (p: { id: ProviderId; model: string }, f: FormField) => `${p.id}|${p.model}|${fieldSignature(f)}`;

/**
 * Classifies unresolved fields. Order of operations (SPEC 13.3 / 13.4 / 13.5):
 * 1) cache (zero network), 2) one batched request for the misses, 3) validate every item deterministically,
 * 4) cache accepted mappings and the model's explicit "unknown" answers (never values).
 * Any provider failure just means fewer accepted mappings; the deterministic autofill is unaffected.
 */
export async function classifyUnresolvedFields(candidates: FormField[], deps: ClassifyDeps): Promise<ClassifyOutcome> {
  const { config, store, providers } = deps;
  const now = deps.now ?? Date.now;
  const stats: ClassifyOutcome["stats"] = { candidates: candidates.length, cacheHits: 0, requests: 0, dropped: 0, provider: null, model: null, error: null };
  if (candidates.length === 0 || providers.length === 0) return { accepted: [], rejected: [], stats };

  const cache = await loadCache(store);
  const fresh = (e: { at: number }) => now() - e.at <= config.cache.ttlMs;
  const hitItems: unknown[] = [];
  const misses: FormField[] = [];
  for (const f of candidates) {
    const hit = providers.map((p) => cache[cacheKey(p, f)]).find((e) => e && fresh(e));
    if (hit) {
      stats.cacheHits++;
      // Cached answers re-enter the same validator as live ones, so policy is applied "after" every time.
      hitItems.push({ fieldId: f.fieldId, semanticType: hit.semanticType, profileKey: hit.profileKey, confidence: hit.confidence, evidence: ["cached"], requiresReview: false });
    } else misses.push(f);
  }

  let liveItems: unknown[] = [];
  let answered: AIProvider | null = null;
  let sentFields: FormField[] = [];
  if (misses.length > 0) {
    const prompt = buildPrompt(misses, config.limits);
    stats.dropped = prompt.dropped;
    if (prompt.included.length > 0) {
      const sent = new Set(prompt.included.map((p) => p.fieldId));
      sentFields = misses.filter((f) => sent.has(f.fieldId));
      const out = await runStructured(
        {
          category: "field_classification",
          system: prompt.system,
          user: prompt.user,
          schema: AiEnvelopeSchema,
          jsonSchema: AI_CLASSIFICATION_JSON_SCHEMA,
          schemaName: "field_mappings",
        },
        {
          providers,
          maxAttemptsPerProvider: config.retry.maxAttemptsPerProvider,
          baseDelayMs: config.retry.baseDelayMs,
          budget: deps.budget,
          sleep: deps.sleep,
          now,
          record: (r) => appendUsage(store, r, config.usage.maxRecords),
        },
      );
      stats.requests = out.attempts;
      if (out.ok) {
        liveItems = out.result.data.mappings;
        stats.provider = out.result.provider;
        stats.model = out.result.model;
        answered = providers.find((p) => p.id === out.result.provider) ?? null;
      } else {
        stats.error = out.error.kind;
      }
    }
  }

  // Only fields that were served from cache or actually sent may be answered.
  const answerable = candidates.filter((c) => !misses.includes(c) || sentFields.includes(c));
  const byId = new Map(candidates.map((c) => [c.fieldId, c]));
  const { accepted, rejected } = validateMappings([...hitItems, ...liveItems], answerable, config.classification.acceptThreshold);

  if (answered && liveItems.length > 0) {
    const next: MappingCache = { ...cache };
    for (const a of accepted) {
      const f = byId.get(a.fieldId);
      if (!f || !misses.includes(f)) continue;
      next[cacheKey(answered, f)] = { semanticType: a.semanticType, profileKey: a.profileKey, confidence: a.confidence, at: now() };
    }
    // Remember "no usable mapping" outcomes (never values) so the same field does not cost a request again.
    for (const r of rejected) {
      const f = byId.get(r.fieldId);
      if (NEGATIVE_CACHEABLE.has(r.reason) && f && misses.includes(f)) {
        next[cacheKey(answered, f)] = { semanticType: "unknown", profileKey: "none", confidence: 0, at: now() };
      }
    }
    await saveCache(store, next, config.cache.maxEntries);
  }
  return { accepted, rejected, stats };
}
