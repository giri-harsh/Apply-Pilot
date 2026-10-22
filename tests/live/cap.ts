import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Hard cap on real API requests for the opt-in live suite. The counter lives in a file that scripts/test-live.mjs resets at
 * the start of every `pnpm test:live`, so it holds across test files (each runs in its own worker). Once the cap is reached
 * every further request throws BEFORE any network traffic.
 */
export const COUNT_FILE = "test-results/live-calls.count";

export type CapDeps = {
  max: number;
  read(): number;
  write(n: number): void;
  fetchImpl(url: string, init: RequestInit): Promise<Response>;
};

export class LiveCapError extends Error {
  constructor(max: number) {
    super(`Live call cap reached (LIVE_MAX_CALLS=${max}); no request was sent`);
  }
}

export function createCappedFetch(d: CapDeps): (url: string, init: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const n = d.read();
    if (n >= d.max) throw new LiveCapError(d.max);
    d.write(n + 1); // counted before the request, so a failing call still uses budget
    return d.fetchImpl(url, init);
  };
}

export const liveMax = (): number => {
  const v = Number(process.env.LIVE_MAX_CALLS ?? "2");
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 2;
};

/** The fetch every live test must use. Never logs URLs, headers or bodies. */
export const cappedFetch = createCappedFetch({
  max: liveMax(),
  read: () => (existsSync(COUNT_FILE) ? Number(readFileSync(COUNT_FILE, "utf8")) || 0 : 0),
  write: (n) => {
    mkdirSync("test-results", { recursive: true });
    writeFileSync(COUNT_FILE, String(n));
  },
  fetchImpl: (u, i) => fetch(u, i),
});

export const liveCalls = (): number => (existsSync(COUNT_FILE) ? Number(readFileSync(COUNT_FILE, "utf8")) || 0 : 0);
