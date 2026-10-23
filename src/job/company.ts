/**
 * Company fallbacks for job pages that carry no structured data (Greenhouse, Lever, Ashby style boards). Pure functions.
 * Nothing here invents a name: each returns null when its pattern does not match.
 */

const MAX = 80;

/** "Job Application for Engineer at Scale Team at Acme" -> "Acme". The LAST " at " wins, since role titles can contain "at". */
export function companyFromTitle(title: string): string | null {
  const t = title.replace(/\s+/g, " ").trim();
  const i = t.toLowerCase().lastIndexOf(" at ");
  if (i <= 0) return null;
  const company = t.slice(i + 4).replace(/\s+[|·•–—-]\s+.*$/, "").trim(); // drop a trailing " | Board name"
  if (company.length < 2 || company.length > MAX) return null;
  if (!t.slice(0, i).trim()) return null; // nothing before it: not a "<role> at <company>" title
  return company;
}

/** Job-board hosts whose first path segment (or `?for=`) is the employer's board token. */
const BOARD_HOSTS = /^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io$|^jobs\.(?:eu\.)?lever\.co$|^jobs\.ashbyhq\.com$|^apply\.workable\.com$|^jobs\.smartrecruiters\.com$/i;
const RESERVED = new Set(["embed", "jobs", "job", "careers", "apply", "j", "o", "app"]);

const titleCase = (s: string) =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

/** The board token of a known job-board URL, title-cased. Low confidence by nature: it is a slug, not a company name. */
export function companyFromSlug(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!BOARD_HOSTS.test(u.hostname)) return null;
  const token = (u.searchParams.get("for") ?? u.pathname.split("/").filter(Boolean)[0] ?? "").trim();
  if (!token || RESERVED.has(token.toLowerCase()) || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,60}$/.test(token) || /^\d+$/.test(token)) return null;
  return titleCase(token);
}
