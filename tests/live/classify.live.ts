import { describe, expect, it } from "vitest";
import { classifyUnresolvedFields } from "@/ai/classify/run";
import { DEFAULT_AI_CONFIG } from "@/ai/config";
import { GeminiProvider } from "@/ai/gemini";
import { GroqProvider } from "@/ai/groq";
import type { AIProvider } from "@/ai/types";
import { field, memoryStore } from "../unit/helpers";

const gemini = process.env.GEMINI_API_KEY ?? "";
const groq = process.env.GROQ_API_KEY ?? "";

/** One tiny classification call per provider that has a key. Real network, real quota (a few hundred tokens). */
async function oneCall(provider: AIProvider) {
  const store = memoryStore();
  const out = await classifyUnresolvedFields([field()], {
    config: DEFAULT_AI_CONFIG,
    store,
    providers: [provider],
    budget: { remaining: 1 },
  });
  expect(out.stats.error, `provider error: ${out.stats.error}`).toBeNull();
  expect(out.stats.requests).toBe(1);
  // Whatever the model decides, the output must have passed our schema and policy; a plain "reach you
  // electronically" label should map to email.
  for (const a of out.accepted) expect(a.fieldId).toBe("field_001");
  return out;
}

describe.skipIf(!gemini)("live: Gemini", () => {
  it("answers one tiny classification request through the real provider code", async () => {
    const p = new GeminiProvider({
      config: DEFAULT_AI_CONFIG.providers.gemini,
      getKey: async () => gemini,
      fetchImpl: (u, i) => fetch(u, i),
      maxResponseChars: DEFAULT_AI_CONFIG.limits.maxResponseChars,
    });
    await oneCall(p);
  });
});

describe.skipIf(!groq)("live: Groq", () => {
  it("answers one tiny classification request through the real provider code", async () => {
    const p = new GroqProvider({
      config: DEFAULT_AI_CONFIG.providers.groq,
      getKey: async () => groq,
      fetchImpl: (u, i) => fetch(u, i),
      maxResponseChars: DEFAULT_AI_CONFIG.limits.maxResponseChars,
    });
    await oneCall(p);
  });
});
