/**
 * Per-origin host permission helpers (SPEC 20.1). The extension never asks for wildcard access at run time: a request
 * names exactly one http(s) origin, as a match pattern without port, path or credentials, and only from a user click.
 */

/** `https://jobs.example.com/apply?id=1` -> `https://jobs.example.com/*`; null for anything that must not be requested. */
export function originPattern(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host || host.includes("*")) return null;
  return `${u.protocol}//${host}/*`;
}

/** The origin a pattern grants, as shown to the user (`https://jobs.example.com`). */
export function originLabel(pattern: string): string {
  return pattern.replace(/\/\*$/, "");
}

/** True for a pattern that names a single concrete http(s) host, never a wildcard or an all-sites pattern. */
export function isSingleOriginPattern(pattern: string): boolean {
  const m = /^(https?):\/\/([^/*:]+)\/\*$/.exec(pattern);
  return m !== null && m[2] !== "" && !m[2]!.startsWith("*");
}

/** The exact payload handed to `chrome.permissions.request` / `remove`: one origin, nothing else. */
export function permissionRequest(url: string): { origins: [string] } | null {
  const p = originPattern(url);
  return p && isSingleOriginPattern(p) ? { origins: [p] } : null;
}

/** Origins the user can see and revoke: granted patterns minus the fixed AI API origins and the e2e loopback grant. */
export function userGrantedOrigins(all: string[], fixed: string[]): string[] {
  const skip = new Set(fixed);
  return all.filter((o) => isSingleOriginPattern(o) && !skip.has(o)).sort();
}

/**
 * Which single origin to ask for. The run record knows it when the service worker could read the tab's URL; otherwise the
 * popup learns it from the tab it was opened on (activeTab) or, for automation, an explicit `?grantOrigin=` hint.
 */
export function chooseGrantOrigin(runPattern: string | null, tabUrl: string | undefined, hint: string | null): string | null {
  if (runPattern && isSingleOriginPattern(runPattern)) return runPattern;
  for (const u of [tabUrl, hint ?? undefined]) {
    const p = u ? originPattern(u) : null;
    if (p && isSingleOriginPattern(p)) return p;
  }
  return null;
}
