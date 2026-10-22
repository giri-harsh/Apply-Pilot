import { describe, expect, it } from "vitest";
import { HISTORY_KEY, HistoryService, MAX_HISTORY, toHistoryRecord } from "@/history/history";
import { cacheHitRate, usageByDay, usageByRun } from "@/history/usage";
import { profileStrings } from "@/diagnostics/redact";
import type { AIRequestRecord } from "@/ai/types";
import type { RunRecord } from "@/shared/run";
import { testProfile } from "../fixtures/profile";
import { memoryStore } from "./helpers";

const profile = testProfile();
const at = Date.parse("2026-10-23T10:00:00Z");

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-00000001", tabId: 1, url: "https://jobs.fakeco.test/apply/42?token=SECRET&email=alex@example.test#x", pageTitle: "t", state: "READY_FOR_REVIEW", history: [], startedAt: at - 5000, updatedAt: at,
    fieldsDiscovered: 4, resumeCount: 0, steps: [{ index: 0, title: "Hello Alex Example", outcome: "final", verified: 3, failed: 0, requiredUnresolved: 0, totalFields: 4, filled: 3, skippedSensitive: 1, ambiguous: 0, unresolved: 0, alreadyCorrect: 0, advancedBy: null, note: null, url: "u", results: [] }],
    counters: { actions: 3, retries: 0, passes: 2, transitions: 0 }, notes: ["Field Alex Example needs a look", "Contact alex@example.test or +91 98765 43210"], answers: [], reason: null,
    job: { title: "ML Intern", company: "Fake Co", confidence: 0.9, warnings: [], skills: [], descriptionChars: 1, fromCache: false, matchScore: 50, topProjects: [] } as never,
    ai: { status: "used", requests: 2, cacheHits: 3, accepted: 4, provider: "groq", error: null },
    needsPermission: false, permissionOrigin: null,
    resume: { status: "tailored", variantId: "ai-ml", variantAuto: true, documentId: "doc1", filename: "FakeCo_ML-Intern_Resume_2026-10-23.pdf", pageCount: 1, warnings: ["one warning"], uploaded: [], uploadVerified: true },
    route: { path: "adapter", adapterId: "fakeats", adapterVersion: 1, reason: "r" }, variantOverride: null,
    report: { totalFields: 4, filled: 3, verified: 3, failed: 0, skippedSensitive: 1, ambiguous: 0, unresolved: 0, alreadyCorrect: 0, requiredUnresolved: 0, aiMapped: 1, aiWritten: 0, steps: [], notes: [],
      results: [
        { fieldId: "f1", label: "Email", outcome: "filled_verified", required: true, reason: "ok", semanticType: "email" },
        { fieldId: "f2", label: "Gender", outcome: "skipped_sensitive", required: false, reason: "Sensitive", semanticType: "gender" },
        { fieldId: "f3", label: "Hi Alex Example", outcome: "unresolved", required: false, reason: "x", semanticType: "unknown" },
      ] },
    ...over,
  } as RunRecord;
}

const svc = (now = at) => {
  const store = memoryStore();
  return { store, h: new HistoryService({ store, loadProfile: async () => profile, now: () => now }) };
};

describe("application history", () => {
  it("one record per finished run: page, outcome, counts, resume, steps, unresolved labels, AI use; the query string is dropped", () => {
    const r = toHistoryRecord(run(), at);
    expect(r).toMatchObject({ id: "run-00000001", host: "jobs.fakeco.test", path: "/apply/42", company: "Fake Co", role: "ML Intern", state: "READY_FOR_REVIEW", route: "adapter fakeats v1", variantId: "ai-ml" });
    expect(r.counts).toMatchObject({ verified: 3, skippedSensitive: 1, requiredUnresolved: 0 });
    expect(r.resume).toMatchObject({ filename: "FakeCo_ML-Intern_Resume_2026-10-23.pdf", uploadVerified: true });
    expect(r.unresolvedLabels).toEqual(["Gender", "Hi Alex Example"]);
    expect(r.ai).toMatchObject({ requests: 2, cacheHits: 3, provider: "groq" });
    expect(JSON.stringify(r)).not.toMatch(/SECRET|token=|#x/);
  });

  it("persists, upserts by run id, lists newest first, deletes one, clears all", async () => {
    const { h, store } = svc();
    await h.record(run());
    await h.record(run({ state: "BLOCKED", reason: "Stopped" }));
    expect(await h.list()).toHaveLength(1);
    expect((await h.list())[0]!.state).toBe("BLOCKED");
    await new HistoryService({ store, loadProfile: async () => profile, now: () => at + 1000 }).record(run({ runId: "run-00000002" }));
    expect((await h.list()).map((x) => x.id)).toEqual(["run-00000002", "run-00000001"]);
    await h.deleteOne("run-00000002");
    expect((await h.list()).map((x) => x.id)).toEqual(["run-00000001"]);
    await h.clearAll();
    expect(await h.list()).toEqual([]);
  });

  it("stored records and the export contain no profile string (labels, notes and titles are masked and scrubbed)", async () => {
    const { h, store } = svc();
    await h.record(run());
    const stored = JSON.stringify((await store.get(HISTORY_KEY))[HISTORY_KEY]).toLowerCase();
    const exported = (await h.exportJson()).toLowerCase();
    for (const s of profileStrings(profile)) {
      expect(stored, `stored leaks "${s}"`).not.toContain(s.toLowerCase());
      expect(exported, `export leaks "${s}"`).not.toContain(s.toLowerCase());
    }
    expect(JSON.parse(exported).records).toHaveLength(1);
  });

  it("keeps only the newest MAX_HISTORY records, and ignores corrupt ones", async () => {
    const { h, store } = svc();
    await store.set({ [HISTORY_KEY]: [{ junk: true }] });
    expect(await h.list()).toEqual([]);
    for (let i = 0; i < MAX_HISTORY + 5; i++) await new HistoryService({ store, loadProfile: async () => null, now: () => at + i }).record(run({ runId: `run-${String(i).padStart(8, "0")}` }));
    const list = await h.list();
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0]!.id).toBe(`run-${String(MAX_HISTORY + 4).padStart(8, "0")}`);
  }, 60_000);
});

describe("AI usage", () => {
  const rec = (day: string, provider: "gemini" | "groq", outcome: AIRequestRecord["outcome"], i = 100, o = 20): AIRequestRecord => ({ at: Date.parse(`${day}T12:00:00Z`), provider, model: "m", category: "field_classification", inputTokens: i, outputTokens: o, latencyMs: 5, outcome });

  it("sums requests, failures and tokens per day and provider", () => {
    const u = usageByDay([rec("2026-10-22", "groq", "ok"), rec("2026-10-22", "groq", "rate_limit", 50, 0), rec("2026-10-22", "gemini", "ok"), rec("2026-10-23", "groq", "ok")]);
    expect(u.map((x) => [x.day, x.provider, x.requests, x.failed, x.inputTokens, x.outputTokens])).toEqual([
      ["2026-10-23", "groq", 1, 0, 100, 20],
      ["2026-10-22", "gemini", 1, 0, 100, 20],
      ["2026-10-22", "groq", 2, 1, 150, 20],
    ]);
  });

  it("per-run requests and the cache hit rate come from the history", () => {
    const rows = [toHistoryRecord(run(), at), toHistoryRecord(run({ runId: "run-00000009", ai: { status: "used", requests: 0, cacheHits: 5, accepted: 0, provider: null, error: null } }), at)];
    expect(usageByRun(rows).map((r) => [r.requests, r.cacheHits])).toEqual([[2, 3], [0, 5]]);
    expect(cacheHitRate(rows)).toBeCloseTo(8 / 10);
    expect(cacheHitRate([])).toBeNull();
  });

  it("a usage record has no field that could hold a prompt or a response", () => {
    expect(Object.keys(rec("2026-10-22", "groq", "ok")).sort()).toEqual(["at", "category", "inputTokens", "latencyMs", "model", "outcome", "outputTokens", "provider"]);
  });
});
