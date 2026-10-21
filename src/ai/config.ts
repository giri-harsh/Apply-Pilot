import { z } from "zod";

/**
 * Single home for model IDs, endpoints, timeouts, token limits and thresholds (SPEC 4.2 / 13.1).
 * Everything here can be overridden from settings via `mergeConfig`; nothing else in the codebase
 * hard-codes these values.
 */

export const PROVIDER_IDS = ["gemini", "groq"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderConfig = {
  endpoint: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  /** Capability flag: when false the provider asks for json_object and relies on Zod (no try/catch probing). */
  supportsJsonSchema: boolean;
  /**
   * Gemini only. How the response schema is supplied:
   *  - "prompt_only": JSON mime type + the schema written into the system prompt (Zod is the validator).
   *  - "response_json_schema": standard JSON Schema in `responseJsonSchema`.
   *  - "response_schema": OpenAPI-subset `responseSchema` (converted).
   * Chosen from live verification, not by probing at runtime.
   */
  geminiSchemaMode?: "prompt_only" | "response_json_schema" | "response_schema";
};

export type AIConfig = {
  providers: Record<ProviderId, ProviderConfig>;
  retry: { maxAttemptsPerProvider: number; baseDelayMs: number };
  limits: {
    /** Network attempts (including retries and fallback) one run may spend. */
    maxRequestsPerRun: number;
    maxFieldsPerRequest: number;
    maxPayloadChars: number;
    maxResponseChars: number;
    maxOptionsPerField: number;
    maxLabelChars: number;
    maxNearbyChars: number;
  };
  classification: { acceptThreshold: number };
  cache: { ttlMs: number; maxEntries: number };
  usage: { maxRecords: number };
  job: { aiEnrichment: boolean; maxDescriptionChars: number };
};

/**
 * Defaults taken from the providers' public docs (checked 2026-10-21):
 *  - Gemini: gemini-3.5-flash-lite is listed as a stable Flash-Lite model.
 *  - Groq: openai/gpt-oss-20b is listed as supporting json_schema (best effort).
 * The user should confirm both under "Needs user config: verify model IDs".
 */
export const DEFAULT_AI_CONFIG: AIConfig = {
  providers: {
    gemini: {
      endpoint: "https://generativelanguage.googleapis.com",
      model: "gemini-3.5-flash-lite",
      timeoutMs: 45_000,
      maxOutputTokens: 1500,
      supportsJsonSchema: true,
      geminiSchemaMode: "prompt_only",
    },
    groq: {
      endpoint: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-20b",
      timeoutMs: 20_000,
      maxOutputTokens: 1500,
      supportsJsonSchema: true,
    },
  },
  retry: { maxAttemptsPerProvider: 2, baseDelayMs: 400 },
  limits: {
    maxRequestsPerRun: 3,
    maxFieldsPerRequest: 40,
    maxPayloadChars: 14_000,
    maxResponseChars: 60_000,
    maxOptionsPerField: 12,
    maxLabelChars: 120,
    maxNearbyChars: 120,
  },
  classification: { acceptThreshold: 0.75 },
  cache: { ttlMs: 30 * 24 * 3600 * 1000, maxEntries: 500 },
  usage: { maxRecords: 200 },
  job: { aiEnrichment: false, maxDescriptionChars: 12_000 },
};

/** Endpoints a user override may point at; everything else is rejected so keys cannot be redirected. */
export const ALLOWED_API_ORIGINS = ["https://generativelanguage.googleapis.com", "https://api.groq.com"] as const;

const providerOverride = z
  .object({
    model: z.string().trim().min(1).max(100).regex(/^[\w./:-]+$/),
    timeoutMs: z.number().int().min(1000).max(60_000),
    maxOutputTokens: z.number().int().min(64).max(8192),
    supportsJsonSchema: z.boolean(),
    geminiSchemaMode: z.enum(["prompt_only", "response_json_schema", "response_schema"]),
  })
  .partial();

/** Validated, range-clamped overrides. Unknown keys are dropped; invalid values reject the whole override. */
export const ConfigOverridesSchema = z
  .object({
    providers: z.object({ gemini: providerOverride.optional(), groq: providerOverride.optional() }).partial().optional(),
    limits: z
      .object({
        maxRequestsPerRun: z.number().int().min(1).max(10),
        maxFieldsPerRequest: z.number().int().min(1).max(100),
        maxPayloadChars: z.number().int().min(1000).max(50_000),
      })
      .partial()
      .optional(),
    classification: z.object({ acceptThreshold: z.number().min(0.5).max(0.99) }).partial().optional(),
    job: z.object({ aiEnrichment: z.boolean() }).partial().optional(),
  })
  .strip();
export type ConfigOverrides = z.infer<typeof ConfigOverridesSchema>;

export function mergeConfig(base: AIConfig, overrides: ConfigOverrides | undefined): AIConfig {
  if (!overrides) return base;
  return {
    ...base,
    providers: {
      gemini: { ...base.providers.gemini, ...overrides.providers?.gemini },
      groq: { ...base.providers.groq, ...overrides.providers?.groq },
    },
    limits: { ...base.limits, ...overrides.limits },
    classification: { ...base.classification, ...overrides.classification },
    job: { ...base.job, ...overrides.job },
  };
}
