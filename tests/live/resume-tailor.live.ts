import { appendFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CONFIG } from "@/ai/config";
import { GroqProvider } from "@/ai/groq";
import { hashMaster } from "@/resume/hash";
import { makeShortenTracked, tailorWithStats } from "@/resume/tailor";
import { memoryStore } from "../unit/helpers";
import { testProfile } from "../fixtures/profile";
import { cappedFetch } from "./cap";
import { jobFixture, masterFixture, variantFixture } from "../unit/resume-tailor/fixtures";

const groq = process.env.GROQ_API_KEY ?? "";
let calls = 0;
const countingFetch = (u: string, i: RequestInit) => {
  calls++;
  return cappedFetch(u, i);
};

/**
 * Phase 7 live smoke: the real tailoring pipeline (rank -> variant -> one batched rewrite -> per-bullet grounding ->
 * at most one regeneration) and one shorten call, against the real Groq API with the fictional fixture master and job.
 * At most 4 real calls in total (this test can make at most 3). A rejected or fallen-back bullet is the validator
 * working, not a failure. Only counts, latencies, token numbers and violation messages are written; never keys.
 */
describe.skipIf(!groq)("live: resume tailoring (Groq)", () => {
  it("rewords grounded bullets or falls back to the master wording, then shortens", async () => {
    const provider = new GroqProvider({
      config: DEFAULT_AI_CONFIG.providers.groq,
      getKey: async () => groq,
      fetchImpl: countingFetch,
      maxResponseChars: DEFAULT_AI_CONFIG.limits.maxResponseChars,
    });
    const ai = { providers: [provider], config: DEFAULT_AI_CONFIG, store: memoryStore() };
    const master = masterFixture();
    const job = jobFixture();
    const before = await hashMaster(master);

    // Real-call allowance for this file: tailor 1-2 (rewrite + at most one regeneration), shorten 0-1. Set by REAL_TAILOR_CALLS
    // (default 2) so a re-run can be capped further; shorten is skipped when the rewrite request itself failed.
    const tailorCalls = Number(process.env.REAL_TAILOR_CALLS ?? 2);
    const { output, run } = await tailorWithStats({ master, variant: variantFixture(), job, match: null, profile: testProfile(), ai, budget: { remaining: tailorCalls } });
    const rewrites = output.report.rewrites;
    const count = (s: string) => rewrites.filter((r) => r.status === s).length;

    // Shorten the three longest bullets with the real model, validated against the master facts.
    const bullets = output.tailored.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).filter((l) => l.role === "bullet");
    const longest = [...bullets].sort((a, b) => b.text.length - a.text.length).slice(0, 3);
    // LIVE_SHORTEN_ONLY=1 (with REAL_TAILOR_CALLS=0) spends the allowance on the shorten request alone.
    const shortenBudget = { remaining: run.calls.some((c) => c.ok) || process.env.LIVE_SHORTEN_ONLY ? Number(process.env.REAL_SHORTEN_CALLS ?? 1) : 0 };
    const { fn, run: shortenRun } = makeShortenTracked({ master, job, ai, budget: shortenBudget });
    const shortened = await fn(longest, { reduceLines: 1, reason: "fit one page" });
    const shortenedCount = shortened.filter((l, i) => l.text !== longest[i]!.text).length;

    const metric = (r: typeof run) =>
      r.calls.map((c) => `${c.category}:${c.ok ? "ok" : "failed"} latencyMs=${c.latencyMs} in=${c.inputTokens ?? "?"} out=${c.outputTokens ?? "?"}`).join("; ");
    const violations = rewrites.flatMap((r) => r.violations.map((v) => `${r.lineId} ${v}`));
    mkdirSync("test-results", { recursive: true });
    appendFileSync(
      "test-results/live-results.txt",
      `${new Date().toISOString()} LIVE resume-tailor groq model=${run.model ?? shortenRun.model ?? "?"} realCalls=${calls} tailorRequests=${run.requests} shortenRequests=${shortenRun.requests} ` +
        `rewriteCandidates=${rewrites.length} accepted=${count("accepted")} keptMaster=${count("kept_master")} fallback=${count("fallback_to_master")} shortenedLines=${shortenedCount}/${longest.length}\n` +
        `  tailor: ${metric(run)} error=${run.error ?? "-"}/${run.errorCode ?? "-"} ${run.errorDetail ?? ""}\n  shorten: ${metric(shortenRun)} error=${shortenRun.error ?? "-"}/${shortenRun.errorCode ?? "-"}\n  warnings: ${JSON.stringify(output.report.warnings)}\n  violations: ${JSON.stringify(violations)}\n`,
    );

    expect(calls).toBeLessThanOrEqual(4);
    expect(run.requests).toBeLessThanOrEqual(2);
    expect(shortenRun.requests).toBeLessThanOrEqual(1);
    expect(await hashMaster(master)).toBe(before);
    // Whatever the model said, no accepted rewrite breaks a rule: figures must be the master's own.
    for (const l of bullets) {
      if (l.origin === "rewritten") expect(l.sourceFactIds.length).toBeGreaterThan(0);
      expect(l.text).not.toMatch(/alex@example\.test|90000/);
    }
    for (const l of shortened) if (l.origin === "rewritten") expect(l.masterText).toBeTruthy();
  });
});
