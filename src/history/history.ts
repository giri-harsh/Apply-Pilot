import { z } from "zod";
import type { KVStore } from "@/ai/storage";
import { maskText, profileStrings, scrubProfile } from "@/diagnostics/redact";
import type { UserProfile } from "@/shared/profile";
import type { RunRecord } from "@/shared/run";

/**
 * SPEC 19.1 application history. One record per finished run: what the page was, what was done, what is left for the user.
 * Records hold structure and outcomes only (labels, counts, reasons), never an entered value; free text is masked and every
 * string the profile holds is scrubbed before storage, so an export cannot leak them either.
 */

export const HISTORY_KEY = "applypilot.history.v1";
export const MAX_HISTORY = 200;

const s = (max = 200) => z.string().max(max);

export const HistoryRecordSchema = z.object({
  id: s(64),
  host: s(120),
  path: s(200),
  company: s().nullable(),
  role: s().nullable(),
  startedAt: z.number(),
  finishedAt: z.number(),
  state: s(30),
  route: s(60),
  variantId: s(80).nullable(),
  resume: z.object({ status: s(20), filename: s(200).nullable(), pageCount: z.number().int().nullable(), documentId: s(80).nullable(), uploadVerified: z.boolean() }),
  steps: z.array(z.object({ index: z.number().int(), title: s(), outcome: s(20), verified: z.number().int(), failed: z.number().int(), requiredUnresolved: z.number().int() })).max(20),
  counts: z.object({ totalFields: z.number().int(), filled: z.number().int(), verified: z.number().int(), failed: z.number().int(), skippedSensitive: z.number().int(), ambiguous: z.number().int(), unresolved: z.number().int(), requiredUnresolved: z.number().int(), aiMapped: z.number().int(), aiWritten: z.number().int() }),
  unresolvedLabels: z.array(s()).max(30),
  warnings: z.array(s(300)).max(12),
  ai: z.object({ requests: z.number().int(), cacheHits: z.number().int(), status: s(20), provider: s(20).nullable() }),
});
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;

export function toHistoryRecord(run: RunRecord, finishedAt: number): HistoryRecord {
  let host = "";
  let path = "";
  try {
    const u = new URL(run.url);
    host = u.hostname;
    path = u.pathname; // no query string, no fragment
  } catch {
    /* left empty */
  }
  const r = run.report;
  const counts = r
    ? { totalFields: r.totalFields, filled: r.filled, verified: r.verified, failed: r.failed, skippedSensitive: r.skippedSensitive, ambiguous: r.ambiguous, unresolved: r.unresolved, requiredUnresolved: r.requiredUnresolved, aiMapped: r.aiMapped, aiWritten: r.aiWritten }
    : { totalFields: 0, filled: 0, verified: 0, failed: 0, skippedSensitive: 0, ambiguous: 0, unresolved: 0, requiredUnresolved: 0, aiMapped: 0, aiWritten: 0 };
  const unresolvedLabels = (r?.results ?? []).filter((x) => x.outcome !== "filled_verified" && x.outcome !== "already_correct").map((x) => maskText(x.label)).slice(0, 30);
  return {
    id: run.runId,
    host: host.slice(0, 120),
    path: maskText(path),
    company: run.job?.company ? maskText(run.job.company) : null,
    role: run.job?.title ? maskText(run.job.title) : null,
    startedAt: run.startedAt,
    finishedAt,
    state: run.state,
    route: run.route ? (run.route.path === "adapter" ? `adapter ${run.route.adapterId} v${run.route.adapterVersion}` : "general agent") : "general agent",
    variantId: run.resume.variantId,
    resume: { status: run.resume.status, filename: run.resume.filename, pageCount: run.resume.pageCount, documentId: run.resume.documentId, uploadVerified: run.resume.uploadVerified },
    steps: run.steps.slice(0, 20).map((st) => ({ index: st.index, title: maskText(st.title), outcome: st.outcome, verified: st.verified, failed: st.failed, requiredUnresolved: st.requiredUnresolved })),
    counts,
    unresolvedLabels,
    warnings: [...run.notes, ...(run.reason ? [run.reason] : []), ...run.resume.warnings].map((w) => maskText(w, 300)).slice(0, 12),
    ai: { requests: run.ai.requests, cacheHits: run.ai.cacheHits, status: run.ai.status, provider: run.ai.provider },
  };
}

export class HistoryService {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private deps: { store: KVStore; loadProfile(): Promise<UserProfile | null>; now(): number }) {}

  async list(): Promise<HistoryRecord[]> {
    const raw = (await this.deps.store.get(HISTORY_KEY))[HISTORY_KEY];
    if (!Array.isArray(raw)) return [];
    return raw
      .flatMap((r) => {
        const p = HistoryRecordSchema.safeParse(r);
        return p.success ? [p.data] : [];
      })
      .sort((a, b) => b.finishedAt - a.finishedAt);
  }

  /** Called when a run reaches a final state. Upserts by run id, scrubs profile strings, keeps the newest MAX_HISTORY. */
  record(run: RunRecord): Promise<void> {
    const next = this.chain.then(async () => {
      const profile = await this.deps.loadProfile();
      const rec = HistoryRecordSchema.parse(scrubProfile(toHistoryRecord(run, this.deps.now()), profile ? profileStrings(profile) : []));
      const rest = (await this.list()).filter((x) => x.id !== rec.id);
      await this.deps.store.set({ [HISTORY_KEY]: [rec, ...rest].slice(0, MAX_HISTORY) });
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  async deleteOne(id: string): Promise<void> {
    await this.deps.store.set({ [HISTORY_KEY]: (await this.list()).filter((x) => x.id !== id) });
  }
  async clearAll(): Promise<void> {
    await this.deps.store.set({ [HISTORY_KEY]: [] });
  }
  /** The JSON the user can export: exactly the stored records, nothing added. */
  async exportJson(): Promise<string> {
    return JSON.stringify({ exportedAt: new Date(this.deps.now()).toISOString(), records: await this.list() }, null, 2);
  }
}
