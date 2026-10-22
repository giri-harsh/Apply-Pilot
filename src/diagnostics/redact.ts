import type { UserProfile } from "@/shared/profile";

/**
 * Redaction for portal captures (phase-8 prep). The capture is built from an ALLOWLIST of structural facts (labels, types,
 * roles, counts), never from field values. These helpers are the second and third lines of defence: mask anything that looks
 * personal in the text that IS captured, and scrub every string the user's profile holds.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi;
const DOMAIN_PATH = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|in|co|dev|app|ai|edu|me|uk|us)(?:\/[^\s)>\]]*)?\b/gi;
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const NUMBER = /\d{4,}/g;

export const MAX_TEXT = 200;

/** Masks emails, URLs, phone-like and long numbers, then truncates. Safe to call on any captured string. */
export function maskText(input: string | null | undefined, max = MAX_TEXT): string {
  if (!input) return "";
  let s = input.replace(/\s+/g, " ").trim();
  s = s.replace(EMAIL, "<email>").replace(URL_LIKE, "<url>").replace(PHONE, "<phone>").replace(NUMBER, "<num>").replace(DOMAIN_PATH, "<url>");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Every string value in the profile of at least 3 characters (names, places, ids, urls...), longest first. */
export function profileStrings(p: UserProfile): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, key = ""): void => {
    if (typeof v === "string") {
      const t = v.trim();
      // provenance/enum-like keys are structure, not personal values
      if (t.length >= 3 && !/^(source|recordedAt|note|category|proficiency|employmentType|workArrangement|employmentPreference|willingToRelocate|schemaVersion)$/.test(key)) out.add(t);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(p);
  return [...out].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces any profile string found (case-insensitive) in any string of an arbitrary JSON value. Returns a new value. */
export function scrubProfile<T>(value: T, strings: string[]): T {
  if (strings.length === 0) return value;
  const re = new RegExp(strings.map(escape).join("|"), "gi");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, "<profile>");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
