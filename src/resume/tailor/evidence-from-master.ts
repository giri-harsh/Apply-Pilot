import type { EvidenceBundle, EvidenceItem } from "@/answers/evidence";
import { findOrgMentions } from "@/answers/grounding";
import { canonicalSkill, extractSkills } from "@/job/skills";
import type { Fact, MasterEntry, MasterResume } from "../schema";

/**
 * Adapter: master-resume facts -> the EvidenceBundle shape the Phase 6 grounding validator expects (imported, never
 * forked). The master's own flags decide what is true:
 *  - `employment` only for entries in the "experience" section (an internship is an experience entry; a project is not);
 *  - `deployed` only when one of the entry's facts or links says so;
 *  - technologies are the skills named in the cited fact plus the technologies of its entry, and nothing else
 *    (the bundle's profile-wide skill set is intentionally EMPTY, so a bullet cannot borrow a tool from elsewhere);
 *  - organisations are the entry's own heading/subheading plus names the source text itself mentions.
 */

export type FactKind = "heading" | "subheading" | "bullet" | "skill" | "summary" | "achievement" | "contact";
export type FactRef = { fact: Fact; kind: FactKind; entry: MasterEntry | null };
export type MasterIndex = { byFact: Map<string, FactRef> };

export function indexMaster(master: MasterResume): MasterIndex {
  const byFact = new Map<string, FactRef>();
  const add = (fact: Fact, kind: FactKind, entry: MasterEntry | null) => {
    if (!byFact.has(fact.factId)) byFact.set(fact.factId, { fact, kind, entry });
  };
  add(master.contact.name, "contact", null);
  for (const f of [master.contact.email, master.contact.phone, master.contact.location]) if (f) add(f, "contact", null);
  for (const l of master.contact.links) add(l.fact, "contact", null);
  if (master.summary) add(master.summary, "summary", null);
  for (const e of master.entries) {
    add(e.heading, "heading", e);
    if (e.subheading) add(e.subheading, "subheading", e);
    for (const b of e.bullets) add(b, "bullet", e);
  }
  for (const g of master.skillGroups) for (const it of g.items) add(it, "skill", null);
  for (const a of master.achievements) add(a, "achievement", null);
  return { byFact };
}

const DEPLOYED = /\b(deployed|in production|production|live (?:demo|site|app|at|url)|hosted (?:on|at)|launched|publicly available)\b/i;
const LINK_DEPLOYED = /\b(live|demo|deployed|production|website)\b/i;

/** A project counts as deployed only if one of its facts or links says so. */
export function entryDeployed(entry: MasterEntry): boolean {
  const facts = [entry.heading.text, entry.subheading?.text ?? "", ...entry.bullets.map((b) => b.text)];
  return facts.some((t) => DEPLOYED.test(t)) || entry.links.some((l) => LINK_DEPLOYED.test(l.label));
}

export const entryTechnologies = (entry: MasterEntry): string[] => [...new Set(entry.technologies.map(canonicalSkill))];

const kindFor = (e: MasterEntry): EvidenceItem["kind"] => (e.section === "projects" ? "project" : e.section === "experience" ? "experience" : "education");

/** One evidence item for one bullet of an entry. `withHeading` also renders the entry heading into the text (cover letters). */
export function itemForBullet(id: string, entry: MasterEntry, bullet: Fact, withHeading = false): EvidenceItem {
  const text = withHeading ? `${entry.heading.text}: ${bullet.text}` : bullet.text;
  return {
    id,
    kind: kindFor(entry),
    title: entry.heading.text,
    text,
    technologies: [...new Set([...extractSkills(text).map(canonicalSkill), ...entryTechnologies(entry)])],
    orgs: [entry.heading.text, ...(entry.subheading ? [entry.subheading.text] : [])],
    deployed: entryDeployed(entry),
    employment: entry.section === "experience",
  };
}

/** A skills/summary/achievement item (no entry): the technologies are exactly the skills the text names. */
export function itemForPlainFacts(id: string, kind: EvidenceItem["kind"], title: string, facts: Fact[]): EvidenceItem {
  const text = facts.map((f) => f.text).join("; ");
  return { id, kind, title, text, technologies: [...new Set(extractSkills(text).map(canonicalSkill))], orgs: [], deployed: false, employment: false };
}

const URL_IN_TEXT = /(?:https?:\/\/[^\s)>"']+|www\.[^\s)>"']+|\b[\w-]+\.(?:com|org|net|io|dev|ai|co|in|app|me|xyz)\b(?:\/[^\s)>"']*)?)/gi;
export const urlsIn = (text: string): string[] => [...text.matchAll(URL_IN_TEXT)].map((m) => m[0]);

/** Names a bullet may legitimately mention: its entry's heading/subheading and names its own source text already uses. */
export function allowedOrgsFor(entry: MasterEntry | null, sourceTexts: string[]): string[] {
  const own = entry ? [entry.heading.text, ...(entry.subheading ? [entry.subheading.text] : [])] : [];
  return [...new Set([...own, ...sourceTexts.flatMap((t) => findOrgMentions(t)), ...own.flatMap((t) => findOrgMentions(t))])];
}

export function bundleOf(items: EvidenceItem[], allowedOrgs: string[], allowedUrls: string[]): EvidenceBundle {
  return { items: new Map(items.map((i) => [i.id, i])), perQuestion: new Map(), profileSkills: new Set<string>(), allowedOrgs, allowedUrls };
}
