import { selectCandidates } from "@/ai/classify/candidates";
import { classifyUnresolvedFields } from "@/ai/classify/run";
import { CONNECTION_TEST_JSON_SCHEMA, ConnectionTestSchema } from "@/ai/classify/schema";
import { DEFAULT_AI_CONFIG, PROVIDER_IDS, mergeConfig, type AIConfig, type ProviderId } from "@/ai/config";
import { GeminiProvider } from "@/ai/gemini";
import { GroqProvider } from "@/ai/groq";
import type { FetchLike } from "@/ai/http";
import { runStructured } from "@/ai/router";
import {
  AI_CACHE_KEY,
  appendUsage,
  clearApiKey,
  clearCache,
  getApiKey,
  keyStatus,
  loadAiSettings,
  loadUsage,
  saveAiSettings,
  setApiKey,
  type AiSettings,
  type KVStore,
} from "@/ai/storage";
import type { AIProvider } from "@/ai/types";
import { enrichJob as enrichJobWithAi } from "@/job/enrich";
import type { JobContext } from "@/job/schema";
import type { AiStatus } from "@/shared/messages";
import type { AiClassifyInput, AiClassifyResult } from "./run-manager";

export type AiServiceDeps = { store: KVStore; fetchImpl: FetchLike; baseConfig?: AIConfig; now?: () => number };

/**
 * Everything AI lives behind this class, inside the service worker. API keys are read here and handed only
 * to provider instances; they are never part of any message, log, record or return value.
 */
export class AiService {
  constructor(private deps: AiServiceDeps) {}

  private async load(): Promise<{ config: AIConfig; settings: AiSettings }> {
    const settings = await loadAiSettings(this.deps.store);
    return { settings, config: mergeConfig(this.deps.baseConfig ?? DEFAULT_AI_CONFIG, settings.overrides) };
  }

  private makeProvider(id: ProviderId, config: AIConfig): AIProvider {
    const common = {
      config: config.providers[id],
      getKey: () => getApiKey(this.deps.store, id),
      fetchImpl: this.deps.fetchImpl,
      maxResponseChars: config.limits.maxResponseChars,
    };
    return id === "gemini" ? new GeminiProvider(common) : new GroqProvider(common);
  }

  /** Providers that have a key, in the user's chosen order. */
  private async configuredProviders(settings: AiSettings, config: AIConfig): Promise<AIProvider[]> {
    const status = await keyStatus(this.deps.store);
    return settings.providerOrder.filter((id) => status[id].configured).map((id) => this.makeProvider(id, config));
  }

  async status(): Promise<AiStatus> {
    const { settings, config } = await this.load();
    const keys = await keyStatus(this.deps.store);
    const usage = await loadUsage(this.deps.store);
    const cache = (await this.deps.store.get(AI_CACHE_KEY))[AI_CACHE_KEY];
    const anyKey = settings.providerOrder.some((p) => keys[p].configured);
    return {
      aiEnabled: settings.aiEnabled,
      mode: !settings.aiEnabled ? "off" : anyKey ? "ready" : "not_configured",
      providerOrder: settings.providerOrder,
      keys,
      models: { gemini: config.providers.gemini.model, groq: config.providers.groq.model },
      usage: { requests: usage.length, lastOutcome: usage.at(-1)?.outcome ?? null },
      cacheEntries: cache && typeof cache === "object" ? Object.keys(cache).length : 0,
      jobEnrichment: config.job.aiEnrichment,
    };
  }

  async setSettings(aiEnabled: boolean, providerOrder: ProviderId[], jobEnrichment?: boolean) {
    const current = await loadAiSettings(this.deps.store);
    const overrides = { ...current.overrides, job: { ...current.overrides.job, aiEnrichment: jobEnrichment ?? current.overrides.job?.aiEnrichment ?? false } };
    return saveAiSettings(this.deps.store, { ...current, aiEnabled, providerOrder, overrides });
  }

  /** Optional job enrichment: off unless AI and the enrichment switch are both on and a key exists. Never throws. */
  async enrichJob(job: JobContext): Promise<JobContext> {
    const { settings, config } = await this.load();
    if (!settings.aiEnabled || !config.job.aiEnrichment) return job;
    const providers = await this.configuredProviders(settings, config);
    if (providers.length === 0) return job;
    try {
      return await enrichJobWithAi(job, { config, store: this.deps.store, providers, budget: { remaining: 1 } });
    } catch {
      return job;
    }
  }

  setKey(provider: ProviderId, secret: string) {
    return setApiKey(this.deps.store, provider, secret);
  }
  clearKey(provider: ProviderId) {
    return clearApiKey(this.deps.store, provider);
  }
  clearCache() {
    return clearCache(this.deps.store);
  }

  /** One minimal real call so the options page can show the true result of the user's key and model. */
  async testConnection(id: ProviderId): Promise<{ success: boolean; provider: ProviderId; outcome: string; latencyMs: number | null }> {
    const { config } = await this.load();
    if (!(await getApiKey(this.deps.store, id))) return { success: false, provider: id, outcome: "no_key", latencyMs: null };
    const provider = this.makeProvider(id, config);
    const out = await runStructured(
      {
        category: "connection_test",
        system: "You reply with JSON only.",
        user: 'Return {"ok": true}.',
        schema: ConnectionTestSchema,
        jsonSchema: CONNECTION_TEST_JSON_SCHEMA,
        schemaName: "connection_test",
        maxOutputTokens: 40,
      },
      {
        providers: [provider],
        maxAttemptsPerProvider: 1,
        baseDelayMs: 0,
        budget: { remaining: 1 },
        record: (r) => appendUsage(this.deps.store, r, config.usage.maxRecords),
      },
    );
    return out.ok
      ? { success: true, provider: id, outcome: "ok", latencyMs: out.result.latencyMs }
      : { success: false, provider: id, outcome: out.error.kind, latencyMs: null };
  }

  /** The RunManager hook. Never throws for provider failures: those become `unavailable`. */
  async classify(input: AiClassifyInput): Promise<AiClassifyResult> {
    const { settings, config } = await this.load();
    const none: AiClassifyResult = { status: "off", accepted: [], requests: 0, cacheHits: 0, provider: null, error: null };
    if (!settings.aiEnabled) return none;
    const providers = await this.configuredProviders(settings, config);
    if (providers.length === 0) return { ...none, status: "not_configured" };

    const { candidates } = selectCandidates(input.fields, input.skipped, config.limits.maxFieldsPerRequest);
    if (candidates.length === 0) return { ...none, status: "used" };

    const out = await classifyUnresolvedFields(candidates, {
      config,
      store: this.deps.store,
      providers,
      budget: { remaining: Math.min(input.requestsRemaining, config.limits.maxRequestsPerRun) },
      now: this.deps.now,
    });
    return {
      status: out.stats.error ? "unavailable" : "used",
      accepted: out.accepted,
      requests: out.stats.requests,
      cacheHits: out.stats.cacheHits,
      provider: out.stats.provider,
      error: out.stats.error,
    };
  }
}

export { PROVIDER_IDS };
