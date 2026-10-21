import { z } from "zod";
import { ConfigOverridesSchema, PROVIDER_IDS, type ProviderId } from "./config";
import type { AIRequestRecord } from "./types";

/** Minimal slice of chrome.storage.local so the logic is unit-testable. */
export interface KVStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const chromeStore = (): KVStore => ({
  get: (k) => chrome.storage.local.get(k),
  set: (i) => chrome.storage.local.set(i),
  remove: (k) => chrome.storage.local.remove(k),
});

// Separate namespaces: settings, keys, usage and cache are never merged into one object (SPEC 20.2).
export const AI_SETTINGS_KEY = "applypilot.ai.settings.v1";
export const AI_KEYS_KEY = "applypilot.ai.keys.v1";
export const AI_USAGE_KEY = "applypilot.ai.usage.v1";
export const AI_CACHE_KEY = "applypilot.ai.cache.v1";

export const AiSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  providerOrder: z
    .array(z.enum(PROVIDER_IDS))
    .min(1)
    .max(2)
    .refine((a) => new Set(a).size === a.length, "Duplicate provider"),
  overrides: ConfigOverridesSchema,
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const DEFAULT_AI_SETTINGS: AiSettings = { aiEnabled: false, providerOrder: ["gemini", "groq"], overrides: {} };

export async function loadAiSettings(store: KVStore): Promise<AiSettings> {
  const raw = (await store.get(AI_SETTINGS_KEY))[AI_SETTINGS_KEY];
  const r = AiSettingsSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_AI_SETTINGS;
}

export async function saveAiSettings(store: KVStore, settings: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = AiSettingsSchema.safeParse(settings);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Invalid settings" };
  await store.set({ [AI_SETTINGS_KEY]: r.data });
  return { ok: true };
}

// ---- keys: only the service worker may call getApiKey ----
export const ApiKeySchema = z
  .string()
  .min(8, "Key looks too short")
  .max(300, "Key looks too long")
  .regex(/^[\w.\-~+/=]+$/, "Key contains unexpected characters");

type KeyMap = Partial<Record<ProviderId, string>>;
async function loadKeys(store: KVStore): Promise<KeyMap> {
  const raw = (await store.get(AI_KEYS_KEY))[AI_KEYS_KEY];
  const r = z.record(z.string(), z.string()).safeParse(raw ?? {});
  return r.success ? (r.data as KeyMap) : {};
}

export async function setApiKey(store: KVStore, provider: ProviderId, key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = ApiKeySchema.safeParse(key.trim());
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Invalid key" };
  await store.set({ [AI_KEYS_KEY]: { ...(await loadKeys(store)), [provider]: r.data } });
  return { ok: true };
}

export async function clearApiKey(store: KVStore, provider: ProviderId): Promise<void> {
  const keys = await loadKeys(store);
  delete keys[provider];
  await store.set({ [AI_KEYS_KEY]: keys });
}

export async function getApiKey(store: KVStore, provider: ProviderId): Promise<string | null> {
  return (await loadKeys(store))[provider] ?? null;
}

/** What the UI may learn about a key: whether it exists and its last 4 characters. Never the key. */
export async function keyStatus(store: KVStore): Promise<Record<ProviderId, { configured: boolean; hint: string }>> {
  const keys = await loadKeys(store);
  const one = (p: ProviderId) => ({ configured: Boolean(keys[p]), hint: keys[p] ? `••••${keys[p]!.slice(-4)}` : "" });
  return { gemini: one("gemini"), groq: one("groq") };
}

// ---- usage log ----
export async function appendUsage(store: KVStore, rec: AIRequestRecord, max: number): Promise<void> {
  const raw = (await store.get(AI_USAGE_KEY))[AI_USAGE_KEY];
  const list = Array.isArray(raw) ? (raw as AIRequestRecord[]) : [];
  list.push(rec);
  await store.set({ [AI_USAGE_KEY]: list.slice(-max) });
}

export async function loadUsage(store: KVStore): Promise<AIRequestRecord[]> {
  const raw = (await store.get(AI_USAGE_KEY))[AI_USAGE_KEY];
  return Array.isArray(raw) ? (raw as AIRequestRecord[]) : [];
}

// ---- mapping cache ----
export const CachedMappingSchema = z.object({
  semanticType: z.string(),
  profileKey: z.string(),
  confidence: z.number().min(0).max(1),
  at: z.number(),
});
export type CachedMapping = z.infer<typeof CachedMappingSchema>;
export type MappingCache = Record<string, CachedMapping>;

export async function loadCache(store: KVStore): Promise<MappingCache> {
  const raw = (await store.get(AI_CACHE_KEY))[AI_CACHE_KEY];
  const r = z.record(z.string(), CachedMappingSchema).safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export async function saveCache(store: KVStore, cache: MappingCache, max: number): Promise<void> {
  const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, max);
  await store.set({ [AI_CACHE_KEY]: Object.fromEntries(entries) });
}

export async function clearCache(store: KVStore): Promise<void> {
  await store.remove(AI_CACHE_KEY);
}
