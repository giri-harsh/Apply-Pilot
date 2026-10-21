import type { ProviderConfig } from "./config";
import { AIError } from "./errors";
import { postJson, type FetchLike } from "./http";
import { extractJson, toGeminiSchema } from "./json";
import type { AIProvider, JsonSchema, StructuredRequest, StructuredResult, TextGenerationRequest, TextGenerationResult, TokenUsage } from "./types";

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

export function buildGeminiBody(
  config: ProviderConfig,
  req: { system: string; user: string; maxOutputTokens?: number },
  structured?: { mode: NonNullable<ProviderConfig["geminiSchemaMode"]>; jsonSchema: JsonSchema },
) {
  let system = req.system;
  const gen: Record<string, unknown> = { temperature: 0, maxOutputTokens: req.maxOutputTokens ?? config.maxOutputTokens };
  if (structured) {
    gen.responseMimeType = "application/json";
    if (structured.mode === "response_schema") gen.responseSchema = toGeminiSchema(structured.jsonSchema);
    else if (structured.mode === "response_json_schema") gen.responseJsonSchema = structured.jsonSchema;
    else system = `${system}\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(structured.jsonSchema)}`;
  }
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    generationConfig: gen,
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
    const mode = this.deps.config.geminiSchemaMode ?? "prompt_only";
    let body: ReturnType<typeof buildGeminiBody>;
    try {
      body = buildGeminiBody(this.deps.config, req, { mode, jsonSchema: req.jsonSchema });
    } catch {
      throw new AIError("unknown", "schema_conversion");
    }
    const { text, usage } = await this.call(body);
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
