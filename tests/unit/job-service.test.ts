import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AiService } from "@/background/ai-service";
import { JobService } from "@/background/job-service";
import { DEFAULT_AI_CONFIG } from "@/ai/config";
import { AIError } from "@/ai/errors";
import { enrichJob, groundSkills, ENRICH_KEY } from "@/job/enrich";
import { extractJob } from "@/job/extract";
import { JOBS_KEY, JOB_TTL_MS, clearJobCache, getCachedJob, jobCacheKey, putCachedJob } from "@/job/storage";
import type { JobContext } from "@/job/schema";
import type { ContentResponse } from "@/shared/messages";
import type { AIProvider, StructuredRequest } from "@/ai/types";
import { testProfile } from "../fixtures/profile";
import { jsonResponse, memoryStore } from "./helpers";

function jobFrom(file: string): JobContext {
  document.documentElement.innerHTML = fs.readFileSync(path.resolve(__dirname, `../synthetic-portals/jobs/${file}.html`), "utf8").replace(/^<!doctype html>/i, "");
  return extractJob(document, `https://jobs.example.test/${file}?utm_source=x`);
}

describe("job cache", () => {
  it("keys by origin + path + meaningful query; ignores tracking params, hash and trailing slash", () => {
    expect(jobCacheKey("https://a.test/jobs/1/?utm_source=x&gclid=1#apply")).toBe("https://a.test/jobs/1");
    expect(jobCacheKey("https://a.test/jobs?id=7&utm_medium=m")).toBe("https://a.test/jobs?id=7");
    expect(jobCacheKey("https://a.test/jobs?b=2&a=1")).toBe("https://a.test/jobs?a=1&b=2");
    expect(jobCacheKey("not a url")).toBe("not a url");
  });

  it("round-trips, expires after the TTL, and can be cleared", async () => {
    const store = memoryStore();
    const job = jobFrom("jsonld");
    await putCachedJob(store, job, 1000);
    expect((await getCachedJob(store, "https://jobs.example.test/jsonld", 2000))?.jobTitle).toBe("Machine Learning Intern");
    expect(await getCachedJob(store, "https://jobs.example.test/jsonld", 1000 + JOB_TTL_MS + 1)).toBeNull();
    await clearJobCache(store);
    expect(store.data[JOBS_KEY]).toBeUndefined();
  });
});

describe("JobService", () => {
  const ok = (job: JobContext): ContentResponse => ({ ok: true, kind: "JOB_EXTRACTED", job });

  it("asks the page once, then serves the same URL from cache with zero page calls", async () => {
    const store = memoryStore();
    const job = jobFrom("jsonld");
    const sendToTab = vi.fn(async () => ok(job));
    const svc = new JobService({ store, injectContent: async () => undefined, sendToTab, loadProfile: async () => testProfile() });
    const first = await svc.forTab(1, job.jobUrl);
    expect(first).toMatchObject({ title: "Machine Learning Intern", company: "Northwind Analytics", fromCache: false });
    const second = await svc.forTab(1, job.jobUrl);
    expect(second?.fromCache).toBe(true);
    expect(sendToTab).toHaveBeenCalledTimes(1);
  });

  it("computes the match from the profile when there is one, and leaves it null otherwise", async () => {
    const job = jobFrom("jsonld");
    const mk = (profile: ReturnType<typeof testProfile> | null) =>
      new JobService({ store: memoryStore(), injectContent: async () => undefined, sendToTab: async () => ok(job), loadProfile: async () => profile });
    expect((await mk(testProfile()).forTab(1, job.jobUrl))?.matchScore).not.toBeNull();
    expect((await mk(null).forTab(1, job.jobUrl))?.matchScore).toBeNull();
  });

  it("does not cache an extraction that found nothing, and survives page errors", async () => {
    const store = memoryStore();
    document.documentElement.innerHTML = "<head></head><body></body>";
    const empty = extractJob(document, "https://x.test/empty");
    const svc = new JobService({ store, injectContent: async () => undefined, sendToTab: async () => ok(empty), loadProfile: async () => null });
    await svc.forTab(1, "https://x.test/empty");
    expect(store.data[JOBS_KEY]).toBeUndefined();
    const bad = new JobService({ store, injectContent: async () => undefined, sendToTab: async () => ({ ok: false, code: "INTERNAL", message: "x" }), loadProfile: async () => null });
    expect(await bad.forTab(1, "https://x.test/other")).toBeNull();
  });

  it("injects the content script only when asked (preview), never on a cache hit", async () => {
    const job = jobFrom("jsonld");
    const inject = vi.fn(async () => undefined);
    const svc = new JobService({ store: memoryStore(), injectContent: inject, sendToTab: async () => ok(job), loadProfile: async () => null });
    await svc.forTab(1, job.jobUrl, { inject: true });
    await svc.forTab(1, job.jobUrl, { inject: true });
    expect(inject).toHaveBeenCalledTimes(1);
  });
});

describe("optional AI enrichment", () => {
  const job = jobFrom("no-jsonld"); // mentions Pandas, NumPy, Tableau, scikit-learn, Spark, GitHub

  it("groundSkills keeps only skills that appear verbatim in the posting", () => {
    const text = "We use Kubernetes and Terraform daily. Familiarity with Snowpipe is useful.";
    expect(groundSkills(["Kubernetes", "snowpipe", "Quantum Hacking", "x", "Terraform!!!", 5, "A".repeat(50)], text, [])).toEqual(["Kubernetes", "snowpipe"]);
    expect(groundSkills(["Kubernetes"], text, ["Kubernetes"])).toEqual([]); // already known
    expect(groundSkills(["k8s"], "uses k8s", ["Kubernetes"])).toEqual([]); // synonym of a known skill
  });

  function provider(skills: unknown[]): AIProvider & { calls: number } {
    const p = {
      id: "gemini" as const, model: "m", calls: 0,
      async generateStructuredOutput<T>(r: StructuredRequest<T>) {
        p.calls++;
        return { data: r.schema.parse({ skills }) as T, provider: "gemini" as const, model: "m", usage: {}, latencyMs: 1 };
      },
      async generateText() { throw new Error("unused"); },
    };
    return p as never;
  }
  const deps = (providers: AIProvider[], store = memoryStore()) => ({ config: DEFAULT_AI_CONFIG, store, providers, budget: { remaining: 2 }, sleep: async () => undefined });

  it("adds grounded skills, rejects invented ones, and caches by posting hash", async () => {
    const store = memoryStore();
    const p = provider(["Dashboards", "Quantum Hacking", "Stipend"]);
    const out = await enrichJob(job, deps([p], store));
    expect(out.aiEnrichedSkills).toEqual(["Dashboards", "Stipend"]); // both verbatim in the text
    expect(out.aiEnrichedSkills).not.toContain("Quantum Hacking");
    expect(out.relevantKeywords).toEqual(expect.arrayContaining(["dashboards"]));
    await enrichJob(job, deps([p], store));
    expect(p.calls).toBe(1); // second call served from the enrichment cache
    expect(JSON.stringify(store.data[ENRICH_KEY])).not.toContain("Contoso"); // skills only, no posting text
  });

  it("returns the job unchanged on provider failure or without providers", async () => {
    const failing = { ...provider([]), generateStructuredOutput: async () => { throw new AIError("network", "x"); } } as unknown as AIProvider;
    expect(await enrichJob(job, deps([failing]))).toEqual(job);
    expect(await enrichJob(job, deps([]))).toEqual(job);
  });

  it("AiService only enriches when AI and the enrichment switch are both on and a key exists", async () => {
    const reply = { candidates: [{ content: { parts: [{ text: JSON.stringify({ skills: ["Dashboards"] }) }] } }] };
    const fetchImpl = vi.fn(async () => jsonResponse(reply));
    const store = memoryStore();
    const ai = new AiService({ store, fetchImpl });
    expect((await ai.enrichJob(job)).aiEnrichedSkills).toEqual([]); // AI off
    await ai.setSettings(true, ["gemini", "groq"]);
    expect((await ai.enrichJob(job)).aiEnrichedSkills).toEqual([]); // enrichment off
    await ai.setSettings(true, ["gemini", "groq"], true);
    expect((await ai.enrichJob(job)).aiEnrichedSkills).toEqual([]); // no key
    expect(fetchImpl).not.toHaveBeenCalled();
    await ai.setKey("gemini", "AIza-test-key-123456");
    expect((await ai.enrichJob(job)).aiEnrichedSkills).toEqual(["Dashboards"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await ai.status()).jobEnrichment).toBe(true);
    // The request carries the public posting text, not the profile or key.
    const body = String((fetchImpl.mock.calls[0] as unknown[])[1] && ((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body);
    expect(body).toContain("Contoso Labs");
    expect(body).not.toContain("AIza-test-key");
    expect(body).not.toContain("Alex Example");
  });
});
