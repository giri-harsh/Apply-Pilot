import type { MasterResume } from "./schema";

/** Stable JSON: object keys sorted, arrays kept in order. Used to prove the master was not touched by tailoring. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 64 hex characters. Every tailored resume and report records the hash of the master it was built from. */
export async function hashMaster(master: MasterResume): Promise<string> {
  return sha256Hex(canonicalJson(master));
}

/** Throws unless the master is byte-for-byte what it was (used around every tailoring run). */
export async function assertMasterUnchanged(master: MasterResume, expectedHash: string): Promise<void> {
  const now = await hashMaster(master);
  if (now !== expectedHash) throw new Error("The master resume was modified during tailoring");
}
