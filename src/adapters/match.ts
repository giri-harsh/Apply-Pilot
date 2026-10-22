import type { HostRule, PageSignal, PortalAdapter } from "./types";

/** The hostname of a URL, lower-cased, without a trailing dot, or null for anything that is not a plain http(s) URL. */
export function hostnameOf(url: string): { host: string; protocol: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null; // "https://good.example@evil.example/" style tricks
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    return host ? { host, protocol: u.protocol } : null;
  } catch {
    return null;
  }
}

const LABEL = /^[a-z0-9-]+$/;

/** Exact host, or `<label>.<domain>` for a label that is explicitly listed. Suffix tricks (`evilfakeats.test`, `fakeats.test.evil.com`) never match. */
export function hostMatchesRule(host: string, rule: HostRule): boolean {
  if (rule.kind === "exact") return host === rule.host.toLowerCase();
  const domain = rule.domain.toLowerCase();
  if (!host.endsWith(`.${domain}`)) return false;
  const label = host.slice(0, host.length - domain.length - 1);
  return LABEL.test(label) && rule.labels.map((l) => l.toLowerCase()).includes(label); // exactly one label, and it must be listed
}

export function adapterMatchesHost(a: PortalAdapter, url: string): boolean {
  const h = hostnameOf(url);
  if (!h) return false;
  if (h.protocol !== "https:" && !a.allowHttp) return false;
  return a.hosts.some((r) => hostMatchesRule(h.host, r));
}

export function signalHolds(doc: Document, s: PageSignal): boolean {
  if (s.kind === "selector") return doc.querySelectorAll(s.selector).length >= (s.min ?? 1);
  if (s.kind === "meta") {
    const v = doc.querySelector(`meta[name="${s.name}" i]`)?.getAttribute("content") ?? "";
    try {
      return new RegExp(s.pattern, "i").test(v);
    } catch {
      return false;
    }
  }
  return Array.from(doc.querySelectorAll("script[src]")).some((sc) => {
    try {
      return new URL(sc.getAttribute("src") ?? "", doc.baseURI).hostname.toLowerCase() === s.host.toLowerCase();
    } catch {
      return false;
    }
  });
}
