import type { ZodTypeAny } from "zod";
import { DEFAULT_AI_CONFIG } from "@/ai/config";
import { AIError } from "@/ai/errors";
import type { AIProvider, StructuredRequest } from "@/ai/types";
import type { TailorAi } from "@/resume/contracts";
import { memoryStore } from "../helpers";

export type Call = { category: string; system: string; user: string };
export type Reply = (call: Call, n: number) => unknown;

/** A scripted provider: returns whatever `reply` says, validated by the request's own schema like a real provider. */
export function scripted(reply: Reply): AIProvider & { calls: Call[] } {
  const p = {
    id: "groq" as const,
    model: "mock-model",
    calls: [] as Call[],
    async generateStructuredOutput<T>(r: StructuredRequest<T>) {
      p.calls.push({ category: r.category, system: r.system, user: r.user });
      const out = reply({ category: r.category, system: r.system, user: r.user }, p.calls.length);
      if (out instanceof AIError) throw out;
      const parsed = (r.schema as ZodTypeAny).safeParse(out);
      if (!parsed.success) throw new AIError("invalid_response", "schema");
      return { data: parsed.data as T, provider: "groq" as const, model: "mock-model", usage: { inputTokens: 10, outputTokens: 10 }, latencyMs: 1 };
    },
    async generateText(): Promise<never> {
      throw new Error("unused");
    },
  };
  return p as never;
}

export function aiWith(provider: AIProvider): NonNullable<TailorAi> {
  return { providers: [provider], config: DEFAULT_AI_CONFIG, store: memoryStore(), sleep: async () => undefined };
}

type PromptBullet = { lineId: string; entry: string; text: string; maxChars: number };

/** The bullets (or lines) the prompt asked about, parsed from the delimited data block. */
export function promptItems(user: string): PromptBullet[] {
  const block = user.split("<<<PAGE_DATA_START\n")[1]!.split("\nPAGE_DATA_END>>>")[0]!;
  const payload = JSON.parse(block) as { bullets?: PromptBullet[]; lines?: PromptBullet[] };
  return payload.bullets ?? payload.lines ?? [];
}

/** Reply with every bullet unchanged except those whose master text is a key of `overrides`. */
export function rewriteReply(overrides: Record<string, string>): Reply {
  return ({ user }) => ({
    items: promptItems(user).map((b) => ({ lineId: b.lineId, text: overrides[b.text] ?? b.text, evidenceFactIds: [b.lineId], claims: [] })),
  });
}
