import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_AI_CONFIG, ConfigOverridesSchema, mergeConfig } from "@/ai/config";
import { AIError, classifyHttpError, isFallbackEligible } from "@/ai/errors";
import { GeminiProvider } from "@/ai/gemini";
import { GroqProvider } from "@/ai/groq";
import { extractJson, toGeminiSchema, validateAgainstJsonSchema } from "@/ai/json";
import { runStructured } from "@/ai/router";
import { AI_CLASSIFICATION_JSON_SCHEMA, AiEnvelopeSchema, AiMappingItemSchema, CONNECTION_TEST_JSON_SCHEMA, ConnectionTestSchema } from "@/ai/classify/schema";
import type { AIProvider, AIRequestRecord, StructuredRequest } from "@/ai/types";
import { jsonResponse, mappingItem } from "./helpers";

const cfg = DEFAULT_AI_CONFIG;
const req: StructuredRequest<{ ok: boolean }> = {
  category: "connection_test", system: "sys", user: "usr", schema: ConnectionTestSchema, jsonSchema: CONNECTION_TEST_JSON_SCHEMA, schemaName: "t",
};

const geminiBody = (text: string, usage = { promptTokenCount: 11, candidatesTokenCount: 3 }) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: usage,
});
const groqBody = (text: string) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });

function gemini(
  fetchImpl: (u: string, i: RequestInit) => Promise<Response>,
  key: string | null = "g-key-123456",
  mode: "prompt_only" | "response_json_schema" | "response_schema" = "response_schema",
) {
  return new GeminiProvider({ config: { ...cfg.providers.gemini, geminiSchemaMode: mode }, getKey: async () => key, fetchImpl, maxResponseChars: 60_000 });
}
function groq(fetchImpl: (u: string, i: RequestInit) => Promise<Response>, over: Partial<typeof cfg.providers.groq> = {}, key: string | null = "q-key-123456") {
  return new GroqProvider({ config: { ...cfg.providers.groq, ...over }, getKey: async () => key, fetchImpl, maxResponseChars: 60_000 });
}
const kind = async (p: Promise<unknown>) => p.then(() => "no error", (e: unknown) => (e instanceof AIError ? e.kind : "other"));

describe("Gemini provider", () => {
  it("builds a REST request with the key in a header, a JSON mime type and an upper-cased response schema", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(geminiBody('{"ok": true}')));
    const r = await gemini(fetchImpl).generateStructuredOutput(req);
    expect(r.data).toEqual({ ok: true });
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.providers.gemini.model}:generateContent`);
    expect(url).not.toContain("key");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("g-key-123456");
    const body = JSON.parse(init.body as string);
    expect(JSON.stringify(body)).not.toContain("g-key-123456");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0 });
    expect(body.generationConfig.responseSchema.type).toBe("OBJECT");
    expect(body.generationConfig.responseSchema.additionalProperties).toBeUndefined();
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(init.credentials).toBe("omit");
  });

  it("default mode is prompt_only (live-verified request shape): schema in the system prompt, JSON mime type, no response schema", async () => {
    expect(cfg.providers.gemini.geminiSchemaMode).toBe("prompt_only");
    const fetchImpl = vi.fn(async () => jsonResponse(geminiBody('{"ok": true}')));
    await gemini(fetchImpl, "g-key-123456", "prompt_only").generateStructuredOutput(req);
    const body = JSON.parse(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBeUndefined();
    expect(body.generationConfig.responseJsonSchema).toBeUndefined();
    expect(body.systemInstruction.parts[0].text).toContain('"properties"');
  });

  it("response_json_schema mode sends the standard JSON schema untouched", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(geminiBody('{"ok": true}')));
    await gemini(fetchImpl, "g-key-123456", "response_json_schema").generateStructuredOutput(req);
    const body = JSON.parse(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).body as string);
    expect(body.generationConfig.responseJsonSchema).toEqual(CONNECTION_TEST_JSON_SCHEMA);
  });

  it.each([
    ["code fences", '```json\n{"ok": true}\n```'],
    ["surrounding prose", 'Sure! Here you go: {"ok": true} Hope that helps.'],
  ])("tolerates JSON wrapped in %s", async (_n, text) => {
    const r = await gemini(async () => jsonResponse(geminiBody(text))).generateStructuredOutput(req);
    expect(r.data).toEqual({ ok: true });
  });

  it("classifies unparseable, schema-mismatching, empty and blocked responses as invalid_response", async () => {
    expect(await kind(gemini(async () => jsonResponse(geminiBody("not json at all"))).generateStructuredOutput(req))).toBe("invalid_response");
    expect(await kind(gemini(async () => jsonResponse(geminiBody('{"ok": "yes"}'))).generateStructuredOutput(req))).toBe("invalid_response");
    expect(await kind(gemini(async () => jsonResponse({ candidates: [] })).generateStructuredOutput(req))).toBe("invalid_response");
    expect(await kind(gemini(async () => jsonResponse({ promptFeedback: { blockReason: "SAFETY" } })).generateStructuredOutput(req))).toBe("invalid_response");
  });

  it("fails with auth and makes no request when no key is stored", async () => {
    const fetchImpl = vi.fn();
    expect(await kind(gemini(fetchImpl, null).generateStructuredOutput(req))).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("generateText returns the text and usage", async () => {
    const r = await gemini(async () => jsonResponse(geminiBody("hello"))).generateText({ category: "connection_test", system: "s", user: "u" });
    expect(r).toMatchObject({ text: "hello", provider: "gemini" });
  });
});

describe("Groq provider", () => {
  it("uses json_schema with a Bearer header when the model supports it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(groqBody('{"ok": true}')));
    const r = await groq(fetchImpl).generateStructuredOutput(req);
    expect(r.data).toEqual({ ok: true });
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 5 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer q-key-123456");
    const body = JSON.parse(init.body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema).toEqual(CONNECTION_TEST_JSON_SCHEMA);
    expect(body.model).toBe(cfg.providers.groq.model);
    expect(JSON.stringify(body)).not.toContain("q-key-123456");
  });

  it("falls back to json_object + schema-in-prompt purely from the capability flag, then validates with Zod", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(groqBody('{"ok": true}')));
    await groq(fetchImpl, { supportsJsonSchema: false }).generateStructuredOutput(req);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain('"properties"');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no probing / retrying to discover support
    expect(await kind(groq(async () => jsonResponse(groqBody('{"ok": 3}')), { supportsJsonSchema: false }).generateStructuredOutput(req))).toBe("invalid_response");
  });

  it("rejects empty content", async () => {
    expect(await kind(groq(async () => jsonResponse({ choices: [{ message: { content: "" } }] })).generateStructuredOutput(req))).toBe("invalid_response");
  });
});

describe("error classification", () => {
  it.each([
    [401, "", "auth"],
    [403, "", "auth"],
    [400, "API key not valid. Please pass a valid API key.", "auth"],
    [429, "slow down", "rate_limit"],
    [429, "You exceeded your current quota, please check your plan and billing details", "quota"],
    [429, "Rate limit reached ... tokens per day (TPD)", "quota"],
    [500, "", "network"],
    [503, "", "network"],
    [408, "", "timeout"],
    [404, "", "unknown"],
  ])("HTTP %i %s -> %s", (status, body, expected) => {
    expect(classifyHttpError(status, body).kind).toBe(expected);
  });

  it("only rate_limit and quota are fallback-eligible", () => {
    expect(["rate_limit", "quota"].every((k) => isFallbackEligible(k as never))).toBe(true);
    expect(["auth", "timeout", "network", "invalid_response", "unknown", "limit"].some((k) => isFallbackEligible(k as never))).toBe(false);
  });

  it("maps real HTTP failures from providers", async () => {
    expect(await kind(gemini(async () => jsonResponse("quota", 429)).generateStructuredOutput(req))).toBe("quota");
    expect(await kind(groq(async () => jsonResponse("x", 401)).generateStructuredOutput(req))).toBe("auth");
    expect(await kind(gemini(async () => jsonResponse("x", 502)).generateStructuredOutput(req))).toBe("network");
    expect(await kind(gemini(async () => { throw new TypeError("Failed to fetch"); }).generateStructuredOutput(req))).toBe("network");
    expect(await kind(gemini(async () => new Response("<html>", { status: 200 })).generateStructuredOutput(req))).toBe("invalid_response");
  });

  it("aborts with a timeout via AbortController", async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    const p = new GeminiProvider({ config: { ...cfg.providers.gemini, timeoutMs: 30 }, getKey: async () => "k-123456789", fetchImpl: hang, maxResponseChars: 1000 });
    expect(await kind(p.generateStructuredOutput(req))).toBe("timeout");
  });

  it("never puts the key, prompt or response body into error objects", async () => {
    try {
      await gemini(async () => jsonResponse("secret body g-key-123456", 500)).generateStructuredOutput(req);
    } catch (e) {
      expect(JSON.stringify(e)).not.toContain("g-key-123456");
      expect(String((e as Error).message)).not.toContain("secret body");
      expect(String((e as Error).message)).not.toContain("usr");
    }
  });
});

function fakeProvider(id: "gemini" | "groq", behaviours: (() => unknown)[]): AIProvider & { calls: number } {
  const p = {
    id,
    model: `${id}-model`,
    calls: 0,
    async generateStructuredOutput<T>(r: StructuredRequest<T>) {
      const b = behaviours[Math.min(p.calls, behaviours.length - 1)]!;
      p.calls++;
      const out = b();
      if (out instanceof AIError) throw out;
      const checked = r.schema.safeParse(out);
      if (!checked.success) throw new AIError("invalid_response", "schema_mismatch");
      return { data: checked.data, provider: id, model: `${id}-model`, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    },
    async generateText() {
      throw new Error("unused");
    },
  };
  return p as AIProvider & { calls: number };
}

describe("router: retry, fallback and budget (SPEC 13.5)", () => {
  const base = (providers: AIProvider[], budget = 10) => {
    const records: AIRequestRecord[] = [];
    return { records, deps: { providers, maxAttemptsPerProvider: 2, baseDelayMs: 1, budget: { remaining: budget }, record: (r: AIRequestRecord) => void records.push(r), sleep: async () => undefined } };
  };

  it("primary 429 -> secondary succeeds once, validated with the same schema", async () => {
    const a = fakeProvider("gemini", [() => new AIError("rate_limit", "http_429")]);
    const b = fakeProvider("groq", [() => ({ ok: true })]);
    const { deps, records } = base([a, b]);
    const out = await runStructured(req, deps);
    expect(out).toMatchObject({ ok: true, attempts: 2 });
    expect(out.ok && out.result.provider).toBe("groq");
    expect(a.calls).toBe(1); // rate limits are not retried on the same provider
    expect(records.map((r) => [r.provider, r.outcome])).toEqual([["gemini", "rate_limit"], ["groq", "ok"]]);
  });

  it("quota also falls back; both failing returns an error (caller continues deterministically)", async () => {
    const a = fakeProvider("gemini", [() => new AIError("quota", "http_429")]);
    const b = fakeProvider("groq", [() => new AIError("rate_limit", "http_429")]);
    const out = await runStructured(req, base([a, b]).deps);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error.kind).toBe("rate_limit");
    expect(a.calls + b.calls).toBe(2); // each tried exactly once: no loop
  });

  it("a fallback answer that violates the schema is rejected, not accepted", async () => {
    const a = fakeProvider("gemini", [() => new AIError("rate_limit", "x")]);
    const b = fakeProvider("groq", [() => ({ ok: "maybe" })]);
    const out = await runStructured(req, base([a, b]).deps);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error.kind).toBe("invalid_response");
    expect(b.calls).toBe(2); // bounded retry on the same provider, then stop
  });

  it("auth failures do not fall back and are not retried", async () => {
    const a = fakeProvider("gemini", [() => new AIError("auth", "http_401")]);
    const b = fakeProvider("groq", [() => ({ ok: true })]);
    const out = await runStructured(req, base([a, b]).deps);
    expect(out.ok).toBe(false);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(0);
  });

  it("retries transient errors within the per-provider budget only", async () => {
    const a = fakeProvider("gemini", [() => new AIError("timeout", "aborted"), () => ({ ok: true })]);
    const out = await runStructured(req, base([a]).deps);
    expect(out).toMatchObject({ ok: true, attempts: 2 });
    const c = fakeProvider("gemini", [() => new AIError("network", "x")]);
    const out2 = await runStructured(req, base([c]).deps);
    expect(out2.ok).toBe(false);
    expect(c.calls).toBe(2);
  });

  it("stops when the per-run request budget is exhausted", async () => {
    const a = fakeProvider("gemini", [() => new AIError("network", "x")]);
    const out = await runStructured(req, base([a], 1).deps);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error.kind).toBe("limit");
    expect(a.calls).toBe(1);
    const none = await runStructured(req, base([a], 0).deps);
    expect(!none.ok && none.error.kind).toBe("limit");
  });

  it("records usage without prompts, responses or keys", async () => {
    const a = fakeProvider("gemini", [() => ({ ok: true })]);
    const { deps, records } = base([a]);
    await runStructured(req, deps);
    expect(Object.keys(records[0]!).sort()).toEqual(["at", "category", "inputTokens", "latencyMs", "model", "outcome", "outputTokens", "provider"]);
  });
});

describe("JSON handling and schemas", () => {
  it("extractJson handles plain, fenced, prose-wrapped and invalid text", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blah {"a":[1,2]} blah')).toEqual({ a: [1, 2] });
    expect(() => extractJson("nothing here")).toThrow();
  });

  it("toGeminiSchema inlines $ref, drops unsupported keywords, upper-cases types and maps nullable anyOf", () => {
    const out = toGeminiSchema({
      $schema: "x",
      type: "object",
      additionalProperties: false,
      $defs: { Name: { type: "string", maxLength: 5, pattern: "^a" } },
      properties: {
        a: { $ref: "#/$defs/Name" },
        b: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
        c: { type: ["string", "null"] },
        d: { type: "array", items: { type: "number" }, default: [] },
      },
      required: ["a"],
    });
    expect(out).toEqual({
      type: "OBJECT",
      properties: {
        a: { type: "STRING", maxLength: 5 },
        b: { type: "INTEGER", minimum: 1, nullable: true },
        c: { type: "STRING", nullable: true },
        d: { type: "ARRAY", items: { type: "NUMBER" } },
      },
      required: ["a"],
    });
    expect(() => toGeminiSchema({ anyOf: [{ type: "string" }, { type: "number" }] })).toThrow();
    expect(() => toGeminiSchema({ $ref: "#/nope" })).toThrow();
  });

  it("the hand-written JSON schema and the Zod schema agree on fixtures", () => {
    const valid = mappingItem();
    const cases: [unknown, boolean][] = [
      [valid, true],
      [mappingItem({ profileKey: "none", semanticType: "unknown", confidence: 0 }), true],
      [mappingItem({ semanticType: "apiKey" }), false],
      [mappingItem({ profileKey: "personal.apiKey" }), false],
      [mappingItem({ confidence: 1.5 }), false],
      [mappingItem({ fieldId: "x".repeat(40) }), false],
      [mappingItem({ evidence: ["a", "b", "c", "d"] }), false],
      [mappingItem({ evidence: ["z".repeat(200)] }), false],
      [mappingItem({ requiresReview: "no" }), false],
      [{ ...valid, extra: 1 }, false], // JSON schema forbids extras; Zod strips them (checked below)
    ];
    const itemSchema = (AI_CLASSIFICATION_JSON_SCHEMA["properties"] as Record<string, { items: Record<string, unknown> }>)["mappings"]!.items;
    for (const [value, ok] of cases) {
      expect(validateAgainstJsonSchema(value, itemSchema)).toBe(ok);
      const zodOk = AiMappingItemSchema.safeParse(value).success;
      // Only deviation: Zod strips unknown keys instead of failing.
      expect(zodOk).toBe(typeof value === "object" && value !== null && "extra" in value ? true : ok);
    }
    expect(validateAgainstJsonSchema({ mappings: [valid] }, AI_CLASSIFICATION_JSON_SCHEMA)).toBe(true);
    expect(validateAgainstJsonSchema({ mappings: "x" }, AI_CLASSIFICATION_JSON_SCHEMA)).toBe(false);
    expect(AiEnvelopeSchema.safeParse({ mappings: [valid, "junk"] }).success).toBe(true);
    expect(z.enum(["a"]).safeParse("a").success).toBe(true);
  });
});

describe("config", () => {
  it("merges validated overrides and ignores unknown keys", () => {
    const o = ConfigOverridesSchema.parse({ providers: { groq: { model: "llama-3.3-70b-versatile", supportsJsonSchema: false } }, limits: { maxRequestsPerRun: 5 }, bogus: 1 });
    const merged = mergeConfig(DEFAULT_AI_CONFIG, o);
    expect(merged.providers.groq).toMatchObject({ model: "llama-3.3-70b-versatile", supportsJsonSchema: false });
    expect(merged.providers.gemini).toEqual(DEFAULT_AI_CONFIG.providers.gemini);
    expect(merged.limits.maxRequestsPerRun).toBe(5);
  });

  it("rejects out-of-range or unsafe overrides, and offers no way to change endpoints", () => {
    expect(ConfigOverridesSchema.safeParse({ limits: { maxRequestsPerRun: 500 } }).success).toBe(false);
    expect(ConfigOverridesSchema.safeParse({ classification: { acceptThreshold: 0.1 } }).success).toBe(false);
    expect(ConfigOverridesSchema.safeParse({ providers: { gemini: { model: "bad model!!" } } }).success).toBe(false);
    const stripped = ConfigOverridesSchema.parse({ providers: { gemini: { endpoint: "https://evil.example" } } });
    expect(mergeConfig(DEFAULT_AI_CONFIG, stripped).providers.gemini.endpoint).toBe("https://generativelanguage.googleapis.com");
  });
});
