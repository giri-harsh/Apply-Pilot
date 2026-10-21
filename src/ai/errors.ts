export const AI_ERROR_KINDS = [
  "timeout",
  "rate_limit",
  "auth",
  "invalid_response",
  "network",
  "quota",
  "limit",
  "unknown",
] as const;
export type AIErrorKind = (typeof AI_ERROR_KINDS)[number];

/** `code` is a short safe string (e.g. "http_429"); it never contains prompts, keys or response bodies. */
export class AIError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    readonly code: string,
  ) {
    super(`${kind}:${code}`);
    this.name = "AIError";
  }
}

/** Maps an HTTP failure to a kind. The body is only inspected for a few well-known quota words. */
export function classifyHttpError(status: number, body: string): AIError {
  const lower = body.slice(0, 2000).toLowerCase();
  const code = `http_${status}`;
  if (status === 401 || status === 403) return new AIError("auth", code);
  if (status === 400 && /api[_ ]?key|invalid.*key|unauthenticated|permission/.test(lower)) return new AIError("auth", code);
  if (status === 408 || status === 504) return new AIError("timeout", code);
  if (status === 429 || /resource_exhausted/.test(lower)) {
    return new AIError(/quota|billing|per day|daily|exceeded your current/.test(lower) ? "quota" : "rate_limit", code);
  }
  if (status >= 500) return new AIError("network", code);
  return new AIError("unknown", code);
}

/** Only these justify switching to the secondary provider (SPEC 13.5). */
export function isFallbackEligible(kind: AIErrorKind): boolean {
  return kind === "rate_limit" || kind === "quota";
}

/** Transient failures worth one more try against the same provider, within the retry budget. */
export function isRetriable(kind: AIErrorKind): boolean {
  return kind === "timeout" || kind === "network" || kind === "invalid_response";
}
