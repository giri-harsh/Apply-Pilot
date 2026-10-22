import { appendFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyUnresolvedFields } from "@/ai/classify/run";
import { DEFAULT_AI_CONFIG } from "@/ai/config";
import { GeminiProvider } from "@/ai/gemini";
import { GroqProvider } from "@/ai/groq";
import { loadUsage } from "@/ai/storage";
import type { AIProvider } from "@/ai/types";
import { field, memoryStore } from "../unit/helpers";
import { cappedFetch } from "./cap";

const gemini = process.env.GEMINI_API_KEY ?? "";
const groq = process.env.GROQ_API_KEY ?? "";
const only = process.env.LIVE_ONLY ?? ""; // "gemini" | "groq" to spend calls on one provider

let calls = 0;
/** Counts every real network request; never logs URLs, headers or bodies (they contain keys / prompts). */
const countingFetch = (u: string, i: RequestInit) => {
  calls++;
  return cappedFetch(u, i); // throws before any network request once LIVE_MAX_CALLS is reached
};

/** One tiny classification call per provider that has a key. Real network, real quota (a few hundred tokens). */
async function oneCall(provider: AIProvider) {
  const store = memoryStore();
  const before = calls;
  const out = await classifyUnresolvedFields([field()], {
    config: DEFAULT_AI_CONFIG,
    store,
    providers: [provider],
    budget: { remaining: 1 },
  });
  const usage = (await loadUsage(store))[0];
  const line = `LIVE ${provider.id} model=${provider.model} outcome=${usage?.outcome ?? "?"} code=${out.stats.errorCode ?? "-"} latencyMs=${usage?.latencyMs ?? "?"} in=${usage?.inputTokens ?? "?"} out=${usage?.outputTokens ?? "?"} realCalls=${calls - before} accepted=${out.accepted.length}${out.stats.errorDetail ? ` detail=${JSON.stringify(out.stats.errorDetail)}` : ""}`;
  // vitest hides console output of passing tests, so also append the (key-free) line to a results file.
  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/live-results.txt", `${new Date().toISOString()} ${line}\n`);
  console.log(line);
  expect(out.stats.error, `provider error: ${out.stats.error} ${out.stats.errorCode} ${out.stats.errorDetail ?? ""}`).toBeNull();
  expect(out.stats.requests).toBe(1);
  for (const a of out.accepted) expect(a.fieldId).toBe("field_001");
  return out;
}

describe.skipIf(!gemini || (only !== "" && only !== "gemini"))("live: Gemini", () => {
  it("answers one tiny classification request through the real provider code", async () => {
    const p = new GeminiProvider({
      config: {
        ...DEFAULT_AI_CONFIG.providers.gemini,
        ...(process.env.LIVE_GEMINI_MODE ? { geminiSchemaMode: process.env.LIVE_GEMINI_MODE as never } : {}),
        ...(process.env.LIVE_GEMINI_THINK ? { geminiThinking: process.env.LIVE_GEMINI_THINK as never } : {}),
      },
      getKey: async () => gemini,
      fetchImpl: countingFetch,
      maxResponseChars: DEFAULT_AI_CONFIG.limits.maxResponseChars,
    });
    await oneCall(p);
  });
});

describe.skipIf(!groq || (only !== "" && only !== "groq"))("live: Groq", () => {
  it("answers one tiny classification request through the real provider code", async () => {
    const p = new GroqProvider({
      config: DEFAULT_AI_CONFIG.providers.groq,
      getKey: async () => groq,
      fetchImpl: countingFetch,
      maxResponseChars: DEFAULT_AI_CONFIG.limits.maxResponseChars,
    });
    await oneCall(p);
  });
});
