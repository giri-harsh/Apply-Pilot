import type { ProviderConfig } from "./config";
import { AIError } from "./errors";
import { postJson, type FetchLike } from "./http";
import { extractJson, toGeminiSchema } from "./json";
import type { AIProvider, StructuredRequest, StructuredResult, TextGenerationRequest, TextGenerationResult, TokenUsage } from "./types";

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

export type ProviderDeps = {
  config: ProviderConfig;
  getKey: () => Promise<string | null>;
  fetchImpl: FetchLike;
  maxResponseChars: number;
};

export function buildGeminiBody(config: ProviderConfig, req: { system: string; user: string; maxOutputTokens?: number }, responseSchema?: unknown) {
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: req.maxOutputTokens ?? config.maxOutputTokens,
      ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
    },
  };
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  constructor(private deps: ProviderDeps) {}
  get model() {
    return this.deps.config.model;
  }

  private async call(body: unknown): Promise<{ text: string; usage: TokenUsage }> {
    const key = await this.deps.getKey();
    if (!key) throw new AIError("auth", "no_key");
    const { endpoint, model, timeoutMs } = this.deps.config;
    const url = `${endpoint}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    // The key travels in a header, never in the URL, so it cannot leak into logs or history.
    const raw = (await postJson(this.deps.fetchImpl, url, { "x-goog-api-key": key }, body, timeoutMs, this.deps.maxResponseChars)) as GeminiResponse;
    if (raw.promptFeedback?.blockReason) throw new AIError("invalid_response", "blocked");
    const text = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new AIError("invalid_response", "empty");
    return { text, usage: { inputTokens: raw.usageMetadata?.promptTokenCount, outputTokens: raw.usageMetadata?.candidatesTokenCount } };
  }

  async generateStructuredOutput<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    let schema: unknown;
    try {
      schema = toGeminiSchema(req.jsonSchema);
    } catch {
      throw new AIError("unknown", "schema_conversion");
    }
    const { text, usage } = await this.call(buildGeminiBody(this.deps.config, req, schema));
    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch {
      throw new AIError("invalid_response", "bad_json");
    }
    const checked = req.schema.safeParse(parsed);
    if (!checked.success) throw new AIError("invalid_response", "schema_mismatch");
    return { data: checked.data, provider: "gemini", model: this.model, usage, latencyMs: Date.now() - started };
  }

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    const started = Date.now();
    const { text, usage } = await this.call(buildGeminiBody(this.deps.config, req));
    return { text, provider: "gemini", model: this.model, usage, latencyMs: Date.now() - started };
  }
}
