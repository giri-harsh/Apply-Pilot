import type { Fact, MasterEntry, MasterResume, ResumeVariant, SectionKey, SkillGroup } from "../schema";

/**
 * A variant is a RULE over factIds (SPEC 7.2): it never holds text. `applyVariant` turns the rule plus the master into
 * the ordered selection the tailoring pipeline works from. It is pure and never mutates the master (the master may be
 * deep-frozen); every array it returns is a fresh copy that references the master's own fact objects.
 */

export const DEFAULT_SECTION_ORDER: SectionKey[] = ["summary", "education", "experience", "projects", "skills", "certifications", "achievements"];
export const ENTRY_SECTIONS = ["education", "experience", "projects", "certifications"] as const;
export type EntrySectionKey = (typeof ENTRY_SECTIONS)[number];

export type SelectedEntry = { entry: MasterEntry; bullets: Fact[] };
export type DroppedItem = { factId: string; reason: string };

export type VariantSelection = {
  /** Sections to render, in order; sections the variant omits or that have no content are left out. */
  sectionOrder: SectionKey[];
  summary: Fact | null;
  entries: Record<EntrySectionKey, SelectedEntry[]>;
  skillGroups: SkillGroup[];
  achievements: Fact[];
  /** Facts the variant left out, with the rule that did it (shown in the report). */
  dropped: DroppedItem[];
};

export type ApplyOptions = {
  /** Relevance 0..1. When given, projects/certifications are ordered by it and unpinned bullets/skills are ordered by it. */
  score?: { fact(factId: string): number; entry(entryId: string): number };
  /** Entries the variant did not list are added (space permitting under the limits) when their score is at least this. */
  fillUnlistedAtLeast?: number;
};

const isEntrySection = (k: SectionKey): k is EntrySectionKey => (ENTRY_SECTIONS as readonly string[]).includes(k);

/** Stable sort by descending score; ties keep the incoming order. */
function stableByScore<T>(items: T[], score: (t: T) => number): T[] {
  return items
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

function pickBullets(entry: MasterEntry, variant: ResumeVariant, opts: ApplyOptions, dropped: DroppedItem[]): Fact[] {
  const excluded = new Set(variant.excludedFactIds);
  const pinned = new Set(variant.pinnedFactIds);
  const kept = entry.bullets.filter((b) => {
    if (excluded.has(b.factId)) {
      dropped.push({ factId: b.factId, reason: "excluded by the variant" });
      return false;
    }
    return true;
  });
  const pins = kept.filter((b) => pinned.has(b.factId));
  let rest = kept.filter((b) => !pinned.has(b.factId));
  if (opts.score) rest = stableByScore(rest, (b) => opts.score!.fact(b.factId));
  const room = Math.max(0, variant.limits.maxBulletsPerEntry - pins.length); // pinned facts are never cut by the cap
  for (const b of rest.slice(room)) dropped.push({ factId: b.factId, reason: "over the variant's bullet limit" });
  // Pinned bullets first (master order), then the chosen others in their (score or master) order.
  return [...pins, ...rest.slice(0, room)];
}

function pickEntries(master: MasterResume, variant: ResumeVariant, section: EntrySectionKey, opts: ApplyOptions, dropped: DroppedItem[]): SelectedEntry[] {
  const excluded = new Set(variant.excludedFactIds);
  const pinned = new Set(variant.pinnedFactIds);
  const all = master.entries.filter((e) => e.section === section);
  const live = all.filter((e) => {
    if (excluded.has(e.heading.factId)) {
      dropped.push({ factId: e.heading.factId, reason: "excluded by the variant" });
      return false;
    }
    return true;
  });
  const pos = new Map(variant.entryOrder.map((id, i) => [id, i]));
  const hasPin = (e: MasterEntry) => e.bullets.some((b) => pinned.has(b.factId)) || pinned.has(e.heading.factId);
  const listed = live.filter((e) => pos.has(e.entryId) || hasPin(e)).sort((a, b) => (pos.get(a.entryId) ?? 9999) - (pos.get(b.entryId) ?? 9999));
  const unlisted = live.filter((e) => !listed.includes(e));
  let pool: MasterEntry[];
  if (variant.entryOrder.length === 0) {
    pool = live; // an empty entryOrder means "everything, master order"
  } else {
    const min = opts.fillUnlistedAtLeast;
    const extra = opts.score && min !== undefined ? unlisted.filter((e) => opts.score!.entry(e.entryId) >= min) : [];
    pool = [...listed, ...extra];
    for (const e of unlisted) if (!extra.includes(e)) dropped.push({ factId: e.heading.factId, reason: "not listed by the variant" });
  }
  if (opts.score && (section === "projects" || section === "certifications")) {
    pool = stableByScore(pool, (e) => (hasPin(e) ? 2 : opts.score!.entry(e.entryId)));
  }
  const limit = section === "projects" ? variant.limits.maxProjects : section === "experience" ? variant.limits.maxExperience : Infinity;
  const kept = pool.slice(0, limit);
  for (const e of pool.slice(limit)) dropped.push({ factId: e.heading.factId, reason: `over the variant's ${section} limit` });
  return kept.map((entry) => ({ entry, bullets: pickBullets(entry, variant, opts, dropped) }));
}

export function applyVariant(master: MasterResume, variant: ResumeVariant, opts: ApplyOptions = {}): VariantSelection {
  const excluded = new Set(variant.excludedFactIds);
  const pinned = new Set(variant.pinnedFactIds);
  const dropped: DroppedItem[] = [];
  const wanted = variant.sectionOrder.length > 0 ? variant.sectionOrder : DEFAULT_SECTION_ORDER;

  const summary = master.summary && wanted.includes("summary") && !excluded.has(master.summary.factId) ? master.summary : null;
  if (master.summary && excluded.has(master.summary.factId)) dropped.push({ factId: master.summary.factId, reason: "excluded by the variant" });

  const entries = {} as Record<EntrySectionKey, SelectedEntry[]>;
  for (const s of ENTRY_SECTIONS) entries[s] = wanted.includes(s) ? pickEntries(master, variant, s, opts, dropped) : [];

  // Skill groups: listed ones first in the variant's order, the rest by relevance (when scored) else master order.
  const gpos = new Map(variant.skillGroupOrder.map((id, i) => [id, i]));
  // Best item first, then the total relevance of the group (so a group full of matches beats one with a single match).
  const groupScore = (g: SkillGroup) => (opts.score ? Math.max(0, ...g.items.map((i) => opts.score!.fact(i.factId))) * 1000 + g.items.reduce((s, i) => s + opts.score!.fact(i.factId), 0) : 0);
  const groups = master.skillGroups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const pa = gpos.get(a.g.groupId);
      const pb = gpos.get(b.g.groupId);
      if (pa !== undefined || pb !== undefined) return (pa ?? 9999) - (pb ?? 9999) || a.i - b.i;
      return groupScore(b.g) - groupScore(a.g) || a.i - b.i;
    })
    .map(({ g }) => {
      const items = g.items.filter((it) => {
        if (excluded.has(it.factId)) {
          dropped.push({ factId: it.factId, reason: "excluded by the variant" });
          return false;
        }
        return true;
      });
      const pins = items.filter((it) => pinned.has(it.factId));
      let rest = items.filter((it) => !pinned.has(it.factId));
      if (opts.score) rest = stableByScore(rest, (it) => opts.score!.fact(it.factId));
      return { ...g, items: [...pins, ...rest] };
    })
    .filter((g) => g.items.length > 0);

  const achievements = master.achievements.filter((a) => {
    if (excluded.has(a.factId)) {
      dropped.push({ factId: a.factId, reason: "excluded by the variant" });
      return false;
    }
    return true;
  });

  const has = (k: SectionKey): boolean =>
    k === "summary" ? summary !== null : k === "skills" ? groups.length > 0 : k === "achievements" ? achievements.length > 0 : isEntrySection(k) ? entries[k].length > 0 : false;
  const sectionOrder = [...new Set(wanted)].filter(has);

  return { sectionOrder, summary, entries, skillGroups: groups, achievements: wanted.includes("achievements") ? achievements : [], dropped };
}
