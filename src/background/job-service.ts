import type { KVStore } from "@/ai/storage";
import { DEFAULT_EXTRACT_OPTIONS } from "@/job/extract";
import { rankAgainstProfile } from "@/job/rank";
import { summarizeJob, type JobContext, type JobSummary } from "@/job/schema";
import { getCachedJob, putCachedJob } from "@/job/storage";
import type { ContentRequest, ContentResponse } from "@/shared/messages";
import type { UserProfile } from "@/shared/profile";

export type JobServiceDeps = {
  store: KVStore;
  injectContent(tabId: number): Promise<void>;
  sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse>;
  loadProfile(): Promise<UserProfile | null>;
  /** Optional AI enrichment (off unless the user enabled it). Must return the job unchanged on any failure. */
  enrich?(job: JobContext): Promise<JobContext>;
  maxChars?: number;
  now?: () => number;
};

/** Job context for a tab: cache first, then the page, then optional enrichment, then profile relevance. */
export class JobService {
  constructor(private deps: JobServiceDeps) {}

  /** `url` is the tab's current URL; a cache hit makes no request to the page at all. */
  async forTab(tabId: number, url: string, opts: { inject?: boolean } = {}): Promise<JobSummary | null> {
    const now = this.deps.now?.() ?? Date.now();
    let job = await getCachedJob(this.deps.store, url, now);
    const fromCache = job !== null;
    if (!job) {
      if (opts.inject) await this.deps.injectContent(tabId);
      const res = await this.deps.sendToTab(tabId, { kind: "EXTRACT_JOB", maxChars: this.deps.maxChars ?? DEFAULT_EXTRACT_OPTIONS.maxChars });
      if (!res.ok || res.kind !== "JOB_EXTRACTED") return null;
      job = res.job;
      if (this.deps.enrich) job = await this.deps.enrich(job).catch(() => job!);
      // Do not cache a failed extraction: the page may simply not have finished rendering.
      if (job.jobTitle || job.descriptionText) await putCachedJob(this.deps.store, job, now);
    }
    const profile = await this.deps.loadProfile();
    const match = profile ? rankAgainstProfile(job, profile) : null;
    return summarizeJob(job, match, fromCache);
  }
}
