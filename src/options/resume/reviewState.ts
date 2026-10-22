import { buildContribution } from "@/resume/import/build";
import type { Fact, MasterEntry, ParsedResume, SectionKey, SkillGroup } from "@/resume/schema";

/**
 * Pure state logic for the resume confirmation UI. Nothing here touches storage: the draft only becomes the master
 * when the UI calls confirmImport() after the user clicks Confirm.
 */
export type Draft = NonNullable<ParsedResume["draft"]>;

const MAX_FACT = 600;

const mapFact = (f: Fact, fn: (f: Fact) => Fact): Fact => fn(f);

/** Applies `fn` to every fact in the draft (used by edit / accept). */
function mapFacts(d: Draft, fn: (f: Fact) => Fact): Draft {
  const c = d.contact;
  return {
    ...d,
    contact: {
      ...c,
      name: mapFact(c.name, fn),
      ...(c.email ? { email: fn(c.email) } : {}),
      ...(c.phone ? { phone: fn(c.phone) } : {}),
      ...(c.location ? { location: fn(c.location) } : {}),
      links: c.links.map((l) => ({ ...l, fact: fn(l.fact) })),
    },
    ...(d.summary ? { summary: fn(d.summary) } : {}),
    entries: d.entries.map((e) => ({ ...e, heading: fn(e.heading), ...(e.subheading ? { subheading: fn(e.subheading) } : {}), bullets: e.bullets.map(fn) })),
    skillGroups: d.skillGroups.map((g) => ({ ...g, items: g.items.map(fn) })),
    achievements: d.achievements.map(fn),
  };
}

export function allDraftFacts(d: Draft): Fact[] {
  const out: Fact[] = [];
  mapFacts(d, (f) => (out.push(f), f));
  return out;
}

/** Edits the wording of one fact. The factId is kept; the user has now looked at it, so the import flag is cleared. */
export function editFactText(d: Draft, factId: string, text: string): Draft {
  const next = text.slice(0, MAX_FACT);
  return mapFacts(d, (f) => (f.factId === factId ? { ...f, text: next, lowConfidence: false } : f));
}

/** The user checked a flagged fact and says it is right. */
export function acceptFact(d: Draft, factId: string): Draft {
  return mapFacts(d, (f) => (f.factId === factId ? { ...f, lowConfidence: false } : f));
}

export function acceptAllFlagged(d: Draft): Draft {
  return mapFacts(d, (f) => (f.lowConfidence ? { ...f, lowConfidence: false } : f));
}

/**
 * Removes one fact. Removing an entry's heading removes the whole entry; a skill group left empty is removed.
 * The contact name cannot be removed (a master needs a name; edit it instead).
 */
export function removeFact(d: Draft, factId: string): Draft {
  const c = d.contact;
  const contact = {
    ...c,
    ...(c.email?.factId === factId ? { email: undefined } : {}),
    ...(c.phone?.factId === factId ? { phone: undefined } : {}),
    ...(c.location?.factId === factId ? { location: undefined } : {}),
    links: c.links.filter((l) => l.fact.factId !== factId),
  };
  for (const k of ["email", "phone", "location"] as const) if (contact[k] === undefined) delete contact[k];
  const entries: MasterEntry[] = d.entries
    .filter((e) => e.heading.factId !== factId)
    .map((e) => {
      const { subheading, ...rest } = e;
      const keepSub = subheading && subheading.factId !== factId;
      return { ...rest, ...(keepSub ? { subheading } : {}), bullets: e.bullets.filter((b) => b.factId !== factId) };
    });
  const skillGroups: SkillGroup[] = d.skillGroups.map((g) => ({ ...g, items: g.items.filter((i) => i.factId !== factId) })).filter((g) => g.items.length > 0);
  const { summary, ...base } = d;
  return {
    ...base,
    contact,
    ...(summary && summary.factId !== factId ? { summary } : {}),
    entries,
    skillGroups,
    achievements: d.achievements.filter((a) => a.factId !== factId),
  };
}

export const removeEntry = (d: Draft, entryId: string): Draft => ({ ...d, entries: d.entries.filter((e) => e.entryId !== entryId) });
export const removeSkillGroup = (d: Draft, groupId: string): Draft => ({ ...d, skillGroups: d.skillGroups.filter((g) => g.groupId !== groupId) });

/**
 * The user decides which section an "unknown" block belongs to. Its source text is parsed as that section and the
 * resulting facts are appended to the draft, flagged for review. The section itself is re-labelled.
 */
export function assignUnknownSection(parsed: ParsedResume, draft: Draft, sectionIndex: number, key: SectionKey, now: Date): { parsed: ParsedResume; draft: Draft } {
  const section = parsed.sections[sectionIndex];
  if (!section || section.key !== "unknown") return { parsed, draft };
  const ctx = { filename: parsed.filename, nowIso: now.toISOString() };
  const c = buildContribution({ key, confidence: 0.5, sourceText: section.sourceText }, sectionIndex, ctx);
  const nextDraft: Draft = {
    ...draft,
    ...(draft.summary || !c.summary ? {} : { summary: c.summary }),
    entries: [...draft.entries, ...c.entries].slice(0, 120),
    skillGroups: [...draft.skillGroups, ...c.skillGroups].slice(0, 20),
    achievements: [...draft.achievements, ...c.achievements].slice(0, 30),
  };
  const sections = parsed.sections.map((s, i) => (i === sectionIndex ? { ...s, key, confidence: 0.5 } : s));
  return { parsed: { ...parsed, sections }, draft: nextDraft };
}

// ------------------------------------------------------------------ what the UI shows, in order

export type ReviewBlock =
  | { kind: "unknown"; id: string; title: string; flagged: true; sectionIndex: number; sourceText: string }
  | { kind: "contact"; id: string; title: string; flagged: boolean }
  | { kind: "summary"; id: string; title: string; flagged: boolean }
  | { kind: "entry"; id: string; title: string; flagged: boolean; entryId: string }
  | { kind: "skillGroup"; id: string; title: string; flagged: boolean; groupId: string }
  | { kind: "achievements"; id: string; title: string; flagged: boolean };

const flaggedAny = (facts: Fact[]) => facts.some((f) => f.lowConfidence);
const entryFacts = (e: MasterEntry) => [e.heading, ...(e.subheading ? [e.subheading] : []), ...e.bullets];
const SECTION_LABEL: Record<SectionKey, string> = { summary: "Summary", education: "Education", experience: "Experience", projects: "Projects", skills: "Skills", certifications: "Certifications", achievements: "Achievements" };

/** Uncertain items (unknown sections, then anything with a flagged fact) come FIRST; the rest keep document order. */
export function reviewBlocks(parsed: ParsedResume, draft: Draft | null): ReviewBlock[] {
  const blocks: ReviewBlock[] = [];
  parsed.sections.forEach((s, i) => {
    if (s.key === "unknown") blocks.push({ kind: "unknown", id: `unknown-${i}`, title: s.heading ? `Not placed: ${s.heading}` : "Not placed: text without a heading", flagged: true, sectionIndex: i, sourceText: s.sourceText });
  });
  if (draft) {
    const c = draft.contact;
    blocks.push({ kind: "contact", id: "contact", title: "Contact", flagged: flaggedAny([c.name, ...(c.email ? [c.email] : []), ...(c.phone ? [c.phone] : []), ...(c.location ? [c.location] : []), ...c.links.map((l) => l.fact)]) });
    if (draft.summary) blocks.push({ kind: "summary", id: "summary", title: "Summary", flagged: draft.summary.lowConfidence });
    for (const e of draft.entries) blocks.push({ kind: "entry", id: e.entryId, title: `${SECTION_LABEL[e.section]}: ${e.heading.text}`, flagged: flaggedAny(entryFacts(e)), entryId: e.entryId });
    for (const g of draft.skillGroups) blocks.push({ kind: "skillGroup", id: g.groupId, title: `Skills: ${g.label}`, flagged: flaggedAny(g.items), groupId: g.groupId });
    if (draft.achievements.length) blocks.push({ kind: "achievements", id: "achievements", title: "Achievements", flagged: flaggedAny(draft.achievements) });
  }
  const rank = (b: ReviewBlock) => (b.kind === "unknown" ? 0 : b.flagged ? 1 : 2);
  return blocks.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).map((x) => x.b);
}

export const flaggedCount = (parsed: ParsedResume, draft: Draft | null): number =>
  parsed.sections.filter((s) => s.key === "unknown").length + (draft ? allDraftFacts(draft).filter((f) => f.lowConfidence).length : 0);

/** Confirm is offered only for a readable file with a draft and a name. Never automatic. */
export const canConfirm = (parsed: ParsedResume | null, draft: Draft | null): boolean => !!parsed && parsed.hasExtractableText && !!draft && draft.contact.name.text.trim() !== "";
