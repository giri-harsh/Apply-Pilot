import { z } from "zod";
import type { KVStore } from "@/ai/storage";
import { JobContextSchema, type JobContext } from "./schema";

// Job postings are public page content, kept apart from the profile, runs and AI data (SPEC 20.2).
export const JOBS_KEY = "applypilot.jobs.v1";
const MAX_ENTRIES = 30;
export const JOB_TTL_MS = 6 * 3600 * 1000;

const EntrySchema = z.object({ job: JobContextSchema, at: z.number() });
const CacheSchema = z.record(z.string(), EntrySchema);

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|source$|trk|igshid$)/i;

/** One cache key per posting: origin + path + meaningful query parameters (tracking params and the hash are dropped). */
export function jobCacheKey(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = params.map(([k, v]) => `${k}=${v}`).join("&");
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}${q ? `?${q}` : ""}`;
  } catch {
    return url;
  }
}

async function load(store: KVStore) {
  const r = CacheSchema.safeParse((await store.get(JOBS_KEY))[JOBS_KEY] ?? {});
  return r.success ? r.data : {};
}

export async function getCachedJob(store: KVStore, url: string, now = Date.now()): Promise<JobContext | null> {
  const e = (await load(store))[jobCacheKey(url)];
  return e && now - e.at <= JOB_TTL_MS ? e.job : null;
}

export async function putCachedJob(store: KVStore, job: JobContext, now = Date.now()): Promise<void> {
  const all = await load(store);
  all[jobCacheKey(job.jobUrl)] = { job, at: now };
  const trimmed = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
  await store.set({ [JOBS_KEY]: Object.fromEntries(trimmed) });
}

export async function clearJobCache(store: KVStore): Promise<void> {
  await store.remove(JOBS_KEY);
}
