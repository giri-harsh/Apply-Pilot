import type { z } from "zod";
import type { ProviderId } from "./config";

export type JsonSchema = { [k: string]: unknown };

export type AIRequestCategory = "field_classification" | "connection_test" | "job_enrichment";

export interface StructuredRequest<T> {
  category: AIRequestCategory;
  system: string;
  user: string;
  /** The real validator. Provider-side schema enforcement is only a hint. */
  schema: z.ZodType<T>;
  jsonSchema: JsonSchema;
  schemaName: string;
  maxOutputTokens?: number;
}

export interface TextGenerationRequest {
  category: AIRequestCategory;
  system: string;
  user: string;
  maxOutputTokens?: number;
}

export type TokenUsage = { inputTokens?: number; outputTokens?: number };

export interface StructuredResult<T> {
  data: T;
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
}

export interface TextGenerationResult {
  text: string;
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
}

/** SPEC 13.1 provider abstraction. Implementations must throw `AIError` and nothing else. */
export interface AIProvider {
  readonly id: ProviderId;
  readonly model: string;
  generateStructuredOutput<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

/** SPEC 23 AIRequestRecord. Deliberately contains no prompt, response, key or personal data. */
export interface AIRequestRecord {
  at: number;
  provider: ProviderId;
  model: string;
  category: AIRequestCategory;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  outcome: "ok" | "timeout" | "rate_limit" | "auth" | "invalid_response" | "network" | "quota" | "limit" | "unknown";
  errorCode?: string;
}
