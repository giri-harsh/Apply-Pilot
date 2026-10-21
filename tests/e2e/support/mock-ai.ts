import type { BrowserContext, Route } from "@playwright/test";

/**
 * Mocks the Gemini and Groq HTTP APIs with context.route. This works for the extension's service worker
 * fetches, so the real provider code (request building, parsing, error classification) runs end to end;
 * only the network is fake. No live API calls are ever made by these tests.
 */

export type PromptField = {
  fieldId: string;
  labelEvidence: { source: string; text: string }[];
  nearbyText: string;
  section: string;
  options: string[];
};

export type ProviderMock = {
  /** Items to return for the fields the extension sent. Default: an explicit "unknown" for each. */
  respond?: (fields: PromptField[]) => unknown[];
  /** Respond with this exact model text (e.g. prose instead of JSON). */
  rawText?: string;
  /** Respond with this HTTP failure instead. */
  fail?: { status: number; body?: string };
  /** Hold the response until this resolves (used to interrupt the service worker mid-call). */
  gate?: Promise<void>;
  /** Called with each classification request's parsed fields. */
  onFields?: (fields: PromptField[]) => void;
  /** Answer items for an answer-generation / regeneration / shortening request. Default: none. */
  answers?: (payload: AnswerPayload, kind: "generation" | "regeneration" | "shortening", user: string) => unknown[];
};

export type AnswerPayload = {
  job: { title: string | null; company: string | null; requiredSkills: string[] } | null;
  questions: { id: string; category: string; question: string; length: string; evidenceIds: string[] }[];
  evidence: { id: string; kind: string; text: string }[];
};

export type AnswerRequest = { provider: "gemini" | "groq"; kind: "generation" | "regeneration" | "shortening"; payload: AnswerPayload; user: string };

export function answerItem(questionId: string, answer: string, evidenceIds: string[], extra: Record<string, unknown> = {}) {
  return { questionId, answer, evidenceIds, claims: [], refusal: "none", ...extra };
}

export type MockAi = {
  answerRequests: AnswerRequest[];
  calls: { gemini: number; groq: number };
  /** Raw request bodies, to assert on what leaves the browser. */
  bodies: { gemini: string[]; groq: string[] };
  set(provider: "gemini" | "groq", mock: ProviderMock): void;
  connection: { gemini: boolean; groq: boolean };
};

const MARK = /<<<PAGE_DATA_START\n([\s\S]*?)\nPAGE_DATA_END>>>/;

export function item(fieldId: string, semanticType: string, profileKey: string, confidence = 0.93, extra: Record<string, unknown> = {}) {
  return { fieldId, semanticType, profileKey, confidence, evidence: ["label matches"], requiresReview: false, ...extra };
}
export const unknown = (fieldId: string) => item(fieldId, "unknown", "none", 0.1);

export async function installMockAi(context: BrowserContext): Promise<MockAi> {
  const mocks: Record<"gemini" | "groq", ProviderMock> = { gemini: {}, groq: {} };
  const state: MockAi = {
    answerRequests: [],
    calls: { gemini: 0, groq: 0 },
    bodies: { gemini: [], groq: [] },
    connection: { gemini: true, groq: true },
    set: (p, m) => {
      mocks[p] = m;
    },
  };

  const handle = (provider: "gemini" | "groq") => async (route: Route) => {
    state.calls[provider]++;
    const raw = route.request().postData() ?? "";
    state.bodies[provider].push(raw);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const user: string =
      provider === "gemini"
        ? (body as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text
        : (body as { messages: { content: string }[] }).messages[1]!.content;
    const mock = mocks[provider];
    if (mock.gate) await mock.gate;
    if (mock.fail) {
      await route.fulfill({ status: mock.fail.status, contentType: "application/json", body: mock.fail.body ?? "{}" });
      return;
    }
    let payload: unknown;
    if (user.includes('Return {"ok": true}')) {
      payload = { ok: state.connection[provider] };
    } else if (user.startsWith("Write an answer for each question")) {
      const parsed = JSON.parse(MARK.exec(user)![1]!) as AnswerPayload;
      const kind: "generation" | "regeneration" | "shortening" = user.includes("rejected for these specific problems")
        ? "regeneration"
        : user.includes("over their length limit")
          ? "shortening"
          : "generation";
      state.answerRequests.push({ provider, kind, payload: parsed, user });
      payload = { answers: mock.answers ? mock.answers(parsed, kind, user) : [] };
    } else {
      const fields = (JSON.parse(MARK.exec(user)![1]!) as PromptField[]) ?? [];
      mock.onFields?.(fields);
      payload = { mappings: mock.respond ? mock.respond(fields) : fields.map((f) => unknown(f.fieldId)) };
    }
    const text = mock.rawText ?? JSON.stringify(payload);
    const reply =
      provider === "gemini"
        ? { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }
        : { choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  };

  await context.route("https://generativelanguage.googleapis.com/**", handle("gemini"));
  await context.route("https://api.groq.com/**", handle("groq"));
  return state;
}

/** Text a "model" would read for a field: all label evidence plus nearby text. */
export const textOf = (f: PromptField) => [...f.labelEvidence.map((l) => l.text), f.nearbyText].join(" | ");
