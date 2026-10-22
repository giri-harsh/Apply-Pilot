import type { AIRequestRecord } from "@/ai/types";
import type { HistoryRecord } from "./history";

/** SPEC 13.4 / 23: usage summaries from what is already stored. No prompt or response content exists to show. */

export type DayUsage = { day: string; provider: string; requests: number; ok: number; failed: number; inputTokens: number; outputTokens: number };
export type RunUsage = { id: string; host: string; company: string | null; at: number; requests: number; cacheHits: number; provider: string | null };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function usageByDay(records: AIRequestRecord[]): DayUsage[] {
  const m = new Map<string, DayUsage>();
  for (const r of records) {
    const k = `${day(r.at)}|${r.provider}`;
    const u = m.get(k) ?? { day: day(r.at), provider: r.provider, requests: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
    u.requests += 1;
    if (r.outcome === "ok") u.ok += 1;
    else u.failed += 1;
    u.inputTokens += r.inputTokens ?? 0;
    u.outputTokens += r.outputTokens ?? 0;
    m.set(k, u);
  }
  return [...m.values()].sort((a, b) => b.day.localeCompare(a.day) || a.provider.localeCompare(b.provider));
}

export function usageByRun(history: HistoryRecord[]): RunUsage[] {
  return history.filter((h) => h.ai.requests > 0 || h.ai.cacheHits > 0).map((h) => ({ id: h.id, host: h.host, company: h.company, at: h.finishedAt, requests: h.ai.requests, cacheHits: h.ai.cacheHits, provider: h.ai.provider }));
}

/** cache hits / (cache hits + requests that went to a provider), or null when there was nothing to answer. */
export function cacheHitRate(history: HistoryRecord[]): number | null {
  const hits = history.reduce((n, h) => n + h.ai.cacheHits, 0);
  const reqs = history.reduce((n, h) => n + h.ai.requests, 0);
  return hits + reqs === 0 ? null : hits / (hits + reqs);
}
