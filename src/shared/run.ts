import { z } from "zod";
import { RUN_STATES } from "./state-machine";
import { CompletionReportSchema } from "./form";

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
  /** Safe, human-readable reason for BLOCKED / FAILED / CANCELLED. Never contains personal values. */
  reason: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RUNS_STORAGE_KEY = "applypilot.runs.v1";
export const RunsMapSchema = z.record(z.string(), RunRecordSchema);
export type RunsMap = z.infer<typeof RunsMapSchema>;
