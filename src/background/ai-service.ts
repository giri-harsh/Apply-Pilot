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
import { generateAnswers, type AnswerQuestion } from "@/answers/generate";
import { classifyQuestion } from "@/answers/questions";
import { clearAnswerCache, deleteAnswer, listAnswers, saveAnswer } from "@/answers/storage";
import type { AiClassifyInput, AiClassifyResult, AnswerPhaseInput, AnswerPhaseResult } from "./run-manager";

export type AiServiceDeps = {
  store: KVStore;
  fetchImpl: FetchLike;
  baseConfig?: AIConfig;
  now?: () => number;
  /** Cached job context for a URL (Phase 5), used as the job slice of the answer prompt. */
  loadJob?: (url: string) => Promise<JobContext | null>;
};

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
      answerMemory: settings.answerMemory,
    };
  }

  async setSettings(aiEnabled: boolean, providerOrder: ProviderId[], jobEnrichment?: boolean, answerMemory?: boolean) {
    const current = await loadAiSettings(this.deps.store);
    const overrides = { ...current.overrides, job: { ...current.overrides.job, aiEnrichment: jobEnrichment ?? current.overrides.job?.aiEnrichment ?? false } };
    return saveAiSettings(this.deps.store, { ...current, aiEnabled, providerOrder, overrides, answerMemory: answerMemory ?? current.answerMemory });
  }

  // ---- reusable answers (SPEC 19.3): saved only on an explicit request ----
  listAnswers() {
    return listAnswers(this.deps.store);
  }
  saveAnswer(a: Parameters<typeof saveAnswer>[1]) {
    return saveAnswer(this.deps.store, a);
  }
  deleteAnswer(id: string) {
    return deleteAnswer(this.deps.store, id);
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
  async clearCache() {
    await clearCache(this.deps.store);
    await clearAnswerCache(this.deps.store);
  }

  /**
   * Phase 6. Deterministic partition first (SPEC 14.5): only technical / profile-answerable questions are ever
   * sent to a model. Refused categories are reported with their reason whether or not AI is on. Never throws.
   */
  async answerQuestions(input: AnswerPhaseInput): Promise<AnswerPhaseResult> {
    const { settings, config } = await this.load();
    const out: AnswerPhaseResult = { status: "off", plan: [], results: [], answers: [], requests: 0, cacheHits: 0, memoryHits: 0, error: null };

    const unresolvedIds = new Set(input.skipped.filter((s) => s.outcome === "unresolved" || s.outcome === "ambiguous").map((s) => s.fieldId));
    // An ambiguous field cannot be filled (the executor refuses it), so it is only ever eligible for a refusal reason.
    const ambiguousIds = new Set(input.skipped.filter((s) => s.outcome === "ambiguous").map((s) => s.fieldId));
    const toGenerate: AnswerQuestion[] = [];
    let n = 0;
    for (const f of input.fields) {
      if (!unresolvedIds.has(f.fieldId) || !f.visible || !f.enabled || f.widget !== "native" || f.currentValue.trim() !== "") continue;
      const isQuestion = f.control === "textarea" || (f.control === "text" && f.semanticType === "open_ended");
      if (!isQuestion) continue;
      const d = classifyQuestion(f.label, f.semanticType);
      if (d.kind === "refuse") {
        const sensitive = ["sensitive_demographic", "eligibility", "legal_declaration", "binding_agreement"].includes(d.category);
        out.results.push({ fieldId: f.fieldId, label: f.label, outcome: sensitive ? "skipped_sensitive" : "unresolved", required: f.required, reason: d.reason, semanticType: f.semanticType });
      } else if (!ambiguousIds.has(f.fieldId)) {
        toGenerate.push({ fieldId: f.fieldId, questionId: `q${++n}`, label: f.label, category: d.category, technologies: d.technologies, limit: f.limit });
      }
    }
    if (toGenerate.length === 0) return { ...out, status: settings.aiEnabled ? "used" : "off" };
    if (!settings.aiEnabled) return out;
    const providers = await this.configuredProviders(settings, config);
    if (providers.length === 0) return { ...out, status: "not_configured" };

    const job = input.url && this.deps.loadJob ? await this.deps.loadJob(input.url).catch(() => null) : null;
    const gen = await generateAnswers(toGenerate, {
      config,
      store: this.deps.store,
      providers,
      budget: { remaining: Math.min(input.requestsRemaining, config.limits.maxRequestsPerRun) },
      profile: input.profile,
      job,
      memoryEnabled: settings.answerMemory,
      now: this.deps.now,
    });
    const byField = new Map(input.fields.map((f) => [f.fieldId, f]));
    for (const r of gen.results) {
      const f = byField.get(r.fieldId)!;
      if (r.status === "ok") {
        out.plan.push({
          fieldId: f.fieldId,
          action: { type: "fill_text", fieldId: f.fieldId, value: r.text },
          semanticType: "open_ended",
          label: f.label,
          required: f.required,
          aiWritten: true,
          evidence: r.evidenceNames,
          confidence: { identification: f.confidence, mapping: 0.5 },
        });
        out.answers.push({ fieldId: f.fieldId, label: f.label.slice(0, 300), category: r.category, text: r.text, evidence: r.evidenceNames, signature: r.signature, source: r.source });
      } else {
        out.results.push({ fieldId: f.fieldId, label: f.label, outcome: "unresolved", required: f.required, reason: r.reason, semanticType: f.semanticType });
      }
    }
    return { ...out, status: gen.stats.error ? "unavailable" : "used", requests: gen.stats.requests, cacheHits: gen.stats.cacheHits, memoryHits: gen.stats.memoryHits, error: gen.stats.error };
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
