import { appendFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CONFIG } from "@/ai/config";
import { GroqProvider } from "@/ai/groq";
import { generateAnswers, type AnswerQuestion } from "@/answers/generate";
import { classifyQuestion } from "@/answers/questions";
import { JobContextSchema } from "@/job/schema";
import { memoryStore } from "../unit/helpers";
import { cappedFetch } from "./cap";
import { richProfile } from "../fixtures/profile";

const groq = process.env.GROQ_API_KEY ?? "";
let calls = 0;
const countingFetch = (u: string, i: RequestInit) => {
  calls++;
  return cappedFetch(u, i);
};

/**
 * Phase 6 live smoke: the real pipeline (question partition -> evidence -> generation -> grounding validator ->
 * regeneration/shortening) against the real Groq API with the fictional fixture profile. At most 2 requests.
 * A rejected, ungrounded answer is the validator working, not a failure.
 */
describe.skipIf(!groq)("live: answer generation (Groq)", () => {
  it("writes grounded answers or has them rejected, and refuses what must not be generated", async () => {
    const labels = [
      { label: "Why do you want to join us? (max 60 words)", limit: { unit: "words" as const, max: 60, source: "text" as const } },
      { label: "Describe a relevant project", limit: { unit: "chars" as const, max: 400, source: "maxlength" as const } },
    ];
    const questions: AnswerQuestion[] = labels.map((q, i) => {
      const d = classifyQuestion(q.label);
      if (d.kind !== "generate") throw new Error("fixture question was refused");
      return { fieldId: `field_00${i + 1}`, questionId: `q${i + 1}`, label: q.label, category: d.category, technologies: d.technologies, limit: q.limit };
    });
    // The partition refuses these without any request.
    for (const refused of ["How did you hear about this opening?", "Describe your gender identity", "Are you legally authorized to work here? Explain"]) {
      expect(classifyQuestion(refused).kind).toBe("refuse");
    }

    const job = JobContextSchema.parse({
      jobTitle: "Machine Learning Intern", company: "Northwind Analytics", jobUrl: "https://jobs.example.test/ml",
      descriptionText: "Northwind Analytics builds forecasting tools for retailers. Requirements: Python and SQL. Preferred: Docker.",
      requiredQualifications: [], preferredQualifications: [], responsibilities: ["Train and evaluate forecasting models"],
      requiredSkills: ["Python", "SQL"], preferredSkills: ["Docker"], educationRequirements: [], experienceRequirements: [],
      location: null, employmentType: "internship", workArrangement: null, relevantKeywords: [], eligibilityNotes: [],
      sourceConfidence: 0.9, sources: { title: "heading", company: "heading", description: "main_content" }, extractionWarnings: [],
    });

    const provider = new GroqProvider({
      config: DEFAULT_AI_CONFIG.providers.groq,
      getKey: async () => groq,
      fetchImpl: countingFetch,
      maxResponseChars: DEFAULT_AI_CONFIG.limits.maxResponseChars,
    });
    const { results, stats } = await generateAnswers(questions, {
      config: DEFAULT_AI_CONFIG, store: memoryStore(), providers: [provider], budget: { remaining: 2 }, profile: richProfile(), job, memoryEnabled: false,
    });

    const lines = results.map((r) =>
      r.status === "ok"
        ? `OK ${r.fieldId} source=${r.source} evidence=[${r.evidenceNames.join("; ")}] text=${JSON.stringify(r.text)}`
        : `REJECTED ${r.fieldId} reason=${JSON.stringify(r.reason)} violations=${JSON.stringify(r.violations.map((v) => `${v.rule}: ${v.detail}`))}`,
    );
    mkdirSync("test-results", { recursive: true });
    appendFileSync(
      "test-results/live-results.txt",
      `${new Date().toISOString()} LIVE answers groq realCalls=${calls} requests=${stats.requests} regenerations=${stats.regenerations} shortenings=${stats.shortenings} error=${stats.error}\n${lines.join("\n")}\n`,
    );

    expect(calls).toBeLessThanOrEqual(2);
    // Either outcome is acceptable; what must never happen is an accepted answer that breaks the rules.
    for (const r of results) {
      if (r.status === "ok") {
        expect(r.evidenceIds.length).toBeGreaterThan(0);
        expect(r.text).not.toMatch(/alex@example\.test|98765|411001/);
      }
    }
  });
});
