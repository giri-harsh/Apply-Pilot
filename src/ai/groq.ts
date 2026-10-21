import { AIError } from "./errors";
import { postJson } from "./http";
import { extractJson } from "./json";
import type { ProviderDeps } from "./gemini";
import type { AIProvider, StructuredRequest, StructuredResult, TextGenerationRequest, TextGenerationResult, TokenUsage } from "./types";

type GroqResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class GroqProvider implements AIProvider {
  readonly id = "groq" as const;
  constructor(private deps: ProviderDeps) {}
  get model() {
    return this.deps.config.model;
  }

  private async call(body: Record<string, unknown>): Promise<{ text: string; usage: TokenUsage }> {
    const key = await this.deps.getKey();
    if (!key) throw new AIError("auth", "no_key");
    const { endpoint, model, timeoutMs } = this.deps.config;
    const raw = (await postJson(
      this.deps.fetchImpl,
      `${endpoint}/chat/completions`,
      { authorization: `Bearer ${key}` },
      { model, temperature: 0, ...body },
      timeoutMs,
      this.deps.maxResponseChars,
    )) as GroqResponse;
    const text = raw.choices?.[0]?.message?.content ?? "";
    if (!text) throw new AIError("invalid_response", "empty");
    return { text, usage: { inputTokens: raw.usage?.prompt_tokens, outputTokens: raw.usage?.completion_tokens } };
  }

  async generateStructuredOutput<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const max = req.maxOutputTokens ?? this.deps.config.maxOutputTokens;
    // Capability comes from config, not from probing: json_schema when supported, otherwise json_object + Zod.
    const useSchema = this.deps.config.supportsJsonSchema;
    const messages = [
      { role: "system", content: useSchema ? req.system : `${req.system}\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(req.jsonSchema)}` },
      { role: "user", content: req.user },
    ];
    const { text, usage } = await this.call({
      messages,
      max_completion_tokens: max,
      response_format: useSchema
        ? { type: "json_schema", json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: false } }
        : { type: "json_object" },
    });
    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch {
      throw new AIError("invalid_response", "bad_json");
    }
    const checked = req.schema.safeParse(parsed);
    if (!checked.success) throw new AIError("invalid_response", "schema_mismatch");
    return { data: checked.data, provider: "groq", model: this.model, usage, latencyMs: Date.now() - started };
  }

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    const started = Date.now();
    const { text, usage } = await this.call({
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_completion_tokens: req.maxOutputTokens ?? this.deps.config.maxOutputTokens,
    });
    return { text, provider: "groq", model: this.model, usage, latencyMs: Date.now() - started };
  }
}
