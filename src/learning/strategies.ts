import { z } from "zod";
import { hashString } from "@/ai/classify/prompt";
import type { FormField } from "@/shared/form";

/**
 * SPEC 10.4 / 19.2 / 23 LearnedStrategy. A learned strategy is an OBSERVED, VERIFIED success: a pattern, the strategy that
 * worked, the evidence, and the page structure it was seen on. It is a hypothesis for next time, never a fact: it is used
 * only when the structure matches within tolerance, always verified after use, demoted on a failure and expired on a second.
 * It never holds a personal value: only types, profile KEYS ("personal.email"), strategy names and hashes of structure.
 */

export const LEARNED_KEY = "applypilot.learned.v1";
export const LEARNING_SETTINGS_KEY = "applypilot.learning.settings.v1";

export const LEARNED_KINDS = ["field_mapping", "input_strategy"] as const;

export const LearnedStrategySchema = z.object({
  id: z.string().min(8).max(40),
  kind: z.enum(LEARNED_KINDS),
  /** The portal: hostname only (no path, no query). */
  host: z.string().max(120),
  /** Hashes of the visible fields' fingerprints on the step where this was learned. */
  structure: z.array(z.string().max(16)).max(80),
  /** Hash of the field fingerprint the strategy applies to. */
  pattern: z.string().max(16),
  value: z.object({
    semanticType: z.string().max(40).optional(),
    profileKey: z.string().max(60).optional(),
    inputStrategy: z.enum(["keyboard"]).optional(),
  }),
  confidence: z.number().min(0).max(1),
  successes: z.number().int().min(0),
  failures: z.number().int().min(0),
  createdAt: z.number(),
  lastVerifiedAt: z.number(),
  expiresAt: z.number(),
});
export type LearnedStrategy = z.infer<typeof LearnedStrategySchema>;

export const LearningSettingsSchema = z.object({ enabled: z.boolean().default(true) });
export type LearningSettings = z.infer<typeof LearningSettingsSchema>;

export const MATCH_TOLERANCE = 0.8; // Jaccard similarity of the structure hash sets
export const USE_THRESHOLD = 0.5; // below this a strategy is demoted: kept for evidence, never used
export const MAX_FAILURES = 2; // the second failure expires it
export const TTL_MS = 60 * 24 * 3600 * 1000;
export const DEMOTED_GRACE_MS = 14 * 24 * 3600 * 1000;
export const MAX_STRATEGIES = 300;

export const fingerprintHash = (fp: string): string => hashString(fp).slice(0, 12);

/** Hashed fingerprints of the visible fields of a step: the "shape" of the page, without any text. */
export function structureOf(fields: FormField[]): string[] {
  return [...new Set(fields.filter((f) => f.visible).map((f) => fingerprintHash(f.fingerprint)))].sort();
}

export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const inter = b.filter((x) => sa.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export const isUsable = (s: LearnedStrategy, now: number): boolean => s.expiresAt > now && s.confidence >= USE_THRESHOLD && s.failures < MAX_FAILURES;

/** Strategies that may be tried on this page: same portal, usable, and a structure that matches within tolerance. */
export function matchStrategies(all: LearnedStrategy[], host: string, structure: string[], now: number): LearnedStrategy[] {
  return all.filter((s) => s.host === host && isUsable(s, now) && similarity(s.structure, structure) >= MATCH_TOLERANCE);
}

export type LearnEvent =
  | { type: "verified"; kind: LearnedStrategy["kind"]; host: string; structure: string[]; pattern: string; value: LearnedStrategy["value"] }
  | { type: "used_ok"; id: string }
  | { type: "used_failed"; id: string };

const sameValue = (a: LearnedStrategy["value"], b: LearnedStrategy["value"]) => a.semanticType === b.semanticType && a.profileKey === b.profileKey && a.inputStrategy === b.inputStrategy;

/** Applies events to the stored list. Pure; returns the new list with expired and twice-failed strategies removed. */
export function applyEvents(list: LearnedStrategy[], events: LearnEvent[], now: number, newId: () => string): LearnedStrategy[] {
  let out = list.map((s) => ({ ...s }));
  const reinforce = (s: LearnedStrategy) => {
    s.successes += 1;
    s.confidence = Math.min(0.95, s.confidence + 0.1);
    s.lastVerifiedAt = now;
    s.expiresAt = now + TTL_MS;
  };
  for (const e of events) {
    if (e.type === "verified") {
      const hit = out.find((s) => s.kind === e.kind && s.host === e.host && s.pattern === e.pattern && sameValue(s.value, e.value));
      if (hit) {
        reinforce(hit);
        hit.structure = e.structure.slice(0, 80);
      } else {
        out.push({ id: newId(), kind: e.kind, host: e.host, structure: e.structure.slice(0, 80), pattern: e.pattern, value: e.value, confidence: 0.6, successes: 1, failures: 0, createdAt: now, lastVerifiedAt: now, expiresAt: now + TTL_MS });
      }
    } else if (e.type === "used_ok") {
      const s = out.find((x) => x.id === e.id);
      if (s) reinforce(s);
    } else {
      const s = out.find((x) => x.id === e.id);
      if (s) {
        s.failures += 1;
        s.confidence = Math.max(0, s.confidence - 0.3); // one failure demotes it below the use threshold
      }
    }
  }
  // Expired, twice-failed, or demoted and not re-verified for two weeks: gone.
  out = out.filter((s) => s.expiresAt > now && s.failures < MAX_FAILURES && !(s.confidence < USE_THRESHOLD && now - s.lastVerifiedAt > DEMOTED_GRACE_MS));
  return out.sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt).slice(0, MAX_STRATEGIES);
}
