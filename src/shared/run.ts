import { z } from "zod";
import { RUN_STATES } from "./state-machine";
import { CompletionReportSchema, FieldResultSchema, StepSummarySchema } from "./form";
import { JobSummarySchema } from "../job/schema";

export const ResumeRunInfoSchema = z.object({
  status: z.enum(["not_needed", "off", "none", "tailored", "reused", "failed"]),
  variantId: z.string().max(80).nullable(),
  variantAuto: z.boolean(),
  documentId: z.string().max(80).nullable(),
  filename: z.string().max(200).nullable(),
  pageCount: z.number().int().nullable(),
  warnings: z.array(z.string().max(300)).max(10),
  /** Fingerprints of file fields already uploaded to in this run, so recovery never uploads twice. */
  uploaded: z.array(z.string().max(300)).max(10),
  /** True only after the page recognised an uploaded file. "Prepared" is not "uploaded". */
  uploadVerified: z.boolean().default(false),
});
export type ResumeRunInfo = z.infer<typeof ResumeRunInfoSchema>;

/** Which path handled the page (SPEC 10.1): a recognised portal adapter, or the general agent, and why. */
export const RouteSchema = z.object({
  path: z.enum(["adapter", "general"]),
  adapterId: z.string().max(40).nullable(),
  adapterVersion: z.number().int().nullable(),
  reason: z.string().max(300),
});
export type Route = z.infer<typeof RouteSchema>;

export const RunRecordSchema = z.object({
  runId: z.string().min(8),
  tabId: z.number().int(),
  url: z.string(),
  pageTitle: z.string(),
  state: z.enum(RUN_STATES),
  history: z.array(z.object({ state: z.enum(RUN_STATES), at: z.number() })),
  startedAt: z.number(),
  updatedAt: z.number(),
  fieldsDiscovered: z.number().int().nonnegative().nullable(),
  resumeCount: z.number().int().nonnegative(),
  report: CompletionReportSchema.nullable(),
  /** Per-step checkpoints (SPEC 15.3): finished steps with their real counts. Resume re-observes; it never replays these. */
  steps: z.array(StepSummarySchema.extend({ results: z.array(FieldResultSchema).max(80) })).max(20).default([]),
  /** Counters enforced against the run limits (SPEC 21.2). They survive a service worker restart. */
  counters: z
    .object({
      actions: z.number().int().nonnegative(),
      retries: z.number().int().nonnegative(),
      passes: z.number().int().nonnegative(),
      transitions: z.number().int().nonnegative(),
    })
    .default({ actions: 0, retries: 0, passes: 0, transitions: 0 }),
  /** Honest notes shown in the report: blockers, unreadable frames, limits, unresolved required fields. */
  notes: z.array(z.string().max(300)).max(20).default([]),
  /** Answers written for this run, kept so the user can save one as a reusable answer after reviewing it. */
  answers: z
    .array(
      z.object({
        fieldId: z.string(),
        label: z.string().max(300),
        category: z.string().max(40),
        text: z.string().max(4000),
        evidence: z.array(z.string().max(200)).max(10),
        signature: z.string().max(200),
        source: z.enum(["generated", "memory", "cache"]),
      }),
    )
    .max(20)
    .default([]),
  /** Resume handling for this run (Phase 7): which variant, which generated or reused file, warnings, what was uploaded. */
  resume: ResumeRunInfoSchema.default({ status: "not_needed", variantId: null, variantAuto: false, documentId: null, filename: null, pageCount: null, warnings: [], uploaded: [], uploadVerified: false }),
  /** The route chosen for the first observation of this run. */
  route: RouteSchema.nullable().default(null),
  /** The user's per-run variant choice (null = automatic). */
  variantOverride: z.string().max(80).nullable().default(null),
  /** What was detected about the job on the page; null when nothing could be read. */
  job: JobSummarySchema.nullable().default(null),
  /** AI usage for this run (SPEC 21.2 limits are enforced against `requests`). */
  ai: z
    .object({
      status: z.enum(["off", "not_configured", "used", "unavailable"]),
      requests: z.number().int().nonnegative(),
      cacheHits: z.number().int().nonnegative(),
      accepted: z.number().int().nonnegative(),
      provider: z.string().nullable(),
      error: z.string().nullable(),
    })
    .default({ status: "off", requests: 0, cacheHits: 0, accepted: 0, provider: null, error: null }),
  /**
   * Set when the run ended BLOCKED because the browser stopped letting us read the page after a navigation.
   * `permissionOrigin` is the origin pattern when the service worker could tell (null when the URL was hidden).
   */
  needsPermission: z.boolean().default(false),
  permissionOrigin: z.string().max(300).nullable().default(null),
  /** Safe, human-readable reason for BLOCKED / FAILED / CANCELLED. Never contains personal values. */
  reason: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RUNS_STORAGE_KEY = "applypilot.runs.v1";
export const RunsMapSchema = z.record(z.string(), RunRecordSchema);
export type RunsMap = z.infer<typeof RunsMapSchema>;
