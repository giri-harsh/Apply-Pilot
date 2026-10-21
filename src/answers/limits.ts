import { z } from "zod";

/** A length limit detected on the page for one answer field (SPEC 14.2 step 9). */
export const LengthLimitSchema = z.object({
  unit: z.enum(["chars", "words"]),
  max: z.number().int().positive().max(20000),
  source: z.enum(["maxlength", "text", "counter"]),
});
export type LengthLimit = z.infer<typeof LengthLimitSchema>;

const UNIT = String.raw`(words?|characters?|chars?|letters?)`;

function unitOf(word: string): "chars" | "words" {
  return /^word/i.test(word) ? "words" : "chars";
}

/**
 * Finds "max 300 words", "up to 500 characters", "300 words maximum", "limit: 1000 characters" and "0/500" counters
 * in text near the field. Returns the strictest limit found, or null.
 */
export function parseLimitFromText(text: string): LengthLimit | null {
  const found: LengthLimit[] = [];
  const t = text.replace(/\s+/g, " ");
  const before = new RegExp(String.raw`\b(?:max(?:imum)?(?:\s+of|\s+length)?|up to|no more than|not (?:to )?exceed(?:ing)?|limit(?:ed)?(?:\s+(?:of|to))?|at most|within|under|less than|maximum)\s*:?\s*(\d{2,5})\s*${UNIT}`, "gi");
  const after = new RegExp(String.raw`\b(\d{2,5})\s*${UNIT}\s*(?:max(?:imum)?|limit|or (?:less|fewer))\b`, "gi");
  const range = new RegExp(String.raw`\b\d{1,4}\s*(?:-|to|–)\s*(\d{2,5})\s*${UNIT}`, "gi");
  for (const re of [before, after, range]) {
    for (const m of t.matchAll(re)) found.push({ unit: unitOf(m[2]!), max: Number(m[1]), source: "text" });
  }
  // Live counters: "0 / 500", "0/500 characters", "500 characters remaining" cannot be known, "(0/250 words)".
  for (const m of t.matchAll(new RegExp(String.raw`\b\d{1,5}\s*/\s*(\d{2,5})\s*${UNIT}?`, "gi"))) {
    found.push({ unit: m[2] ? unitOf(m[2]) : "chars", max: Number(m[1]), source: "counter" });
  }
  if (found.length === 0) return null;
  // Compare on a common scale (about 6 characters per word) and keep the strictest.
  const scale = (l: LengthLimit) => (l.unit === "words" ? l.max * 6 : l.max);
  return found.reduce((a, b) => (scale(b) < scale(a) ? b : a));
}

export function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

export function measure(text: string, unit: "chars" | "words"): number {
  return unit === "words" ? countWords(text) : text.length;
}

export function withinLimit(text: string, limit: LengthLimit | null): boolean {
  return limit === null || measure(text, limit.unit) <= limit.max;
}

/** Default when the page states no limit: keep answers short enough for a form field. */
export const DEFAULT_LIMIT: LengthLimit = { unit: "words", max: 200, source: "text" };

/** The target the model is asked to hit: a little under the hard limit so counting differences do not matter. */
export function targetFor(limit: LengthLimit): number {
  return Math.max(10, Math.floor(limit.max * 0.9));
}
