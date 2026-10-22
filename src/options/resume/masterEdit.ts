import type { Fact, MasterResume, ResumeVariant } from "@/resume/schema";

/**
 * Pure edit operations for the master resume (Settings > Resume). They return a NEW master; nothing mutates the input.
 * Tailoring never calls any of this: only the user, from the editor, changes the master.
 */

const mapFact = (m: MasterResume, f: (fact: Fact) => Fact): MasterResume => ({
  ...m,
  contact: {
    ...m.contact,
    name: f(m.contact.name),
    ...(m.contact.email ? { email: f(m.contact.email) } : {}),
    ...(m.contact.phone ? { phone: f(m.contact.phone) } : {}),
    ...(m.contact.location ? { location: f(m.contact.location) } : {}),
    links: m.contact.links.map((l) => ({ ...l, fact: f(l.fact) })),
  },
  ...(m.summary ? { summary: f(m.summary) } : {}),
  entries: m.entries.map((e) => ({ ...e, heading: f(e.heading), ...(e.subheading ? { subheading: f(e.subheading) } : {}), bullets: e.bullets.map(f) })),
  skillGroups: m.skillGroups.map((g) => ({ ...g, items: g.items.map(f) })),
  achievements: m.achievements.map(f),
});

/** Every fact of the master, in reading order. */
export function allFacts(m: MasterResume): Fact[] {
  const out: Fact[] = [];
  mapFact(m, (f) => (out.push(f), f));
  return out;
}

/** Replaces the wording of one fact. The fact keeps its id; its provenance becomes "user_edited" with the edit time. */
export function editFact(m: MasterResume, factId: string, text: string, now: Date): MasterResume {
  const clean = text.trim();
  if (!clean) throw new Error("A fact cannot be empty; delete it instead");
  return mapFact(m, (f) => (f.factId === factId ? { ...f, text: clean.slice(0, 600), lowConfidence: false, provenance: { source: "user_edited", recordedAt: now.toISOString(), note: "edited in Settings" } } : f));
}

export type Removal = { master: MasterResume; removedFactIds: string[]; removedEntryIds: string[] };

/**
 * Deletes one fact. Bullets, skill items, achievements, the summary, a subheading and contact links can go; a name, an
 * entry heading or a skill group's last item cannot be deleted on its own (delete the entry or group instead).
 */
export function deleteFact(m: MasterResume, factId: string): Removal {
  const removed: string[] = [];
  const keep = (f: Fact) => (f.factId === factId ? (removed.push(f.factId), false) : true);
  const next: MasterResume = {
    ...m,
    contact: {
      ...m.contact,
      ...(m.contact.email?.factId === factId ? { email: undefined } : {}),
      ...(m.contact.phone?.factId === factId ? { phone: undefined } : {}),
      ...(m.contact.location?.factId === factId ? { location: undefined } : {}),
      links: m.contact.links.filter((l) => keep(l.fact)),
    },
    entries: m.entries.map((e) => ({ ...e, subheading: e.subheading && keep(e.subheading) ? e.subheading : undefined, bullets: e.bullets.filter(keep) })),
    skillGroups: m.skillGroups.map((g) => ({ ...g, items: g.items.filter(keep) })).filter((g) => g.items.length > 0),
    achievements: m.achievements.filter(keep),
  };
  for (const f of [m.contact.email, m.contact.phone, m.contact.location]) if (f?.factId === factId) removed.push(factId);
  if (m.summary?.factId === factId) {
    removed.push(factId);
    delete next.summary;
  } else if (m.summary) next.summary = m.summary;
  if (m.contact.name.factId === factId) throw new Error("The name cannot be deleted; edit it instead");
  if (m.entries.some((e) => e.heading.factId === factId)) throw new Error("An entry heading cannot be deleted alone; delete the whole entry");
  // JSON round-trip drops the `undefined` keys left by the spreads above.
  return { master: JSON.parse(JSON.stringify(next)) as MasterResume, removedFactIds: [...new Set(removed)], removedEntryIds: [] };
}

/** Deletes a whole entry (with all its facts). */
export function deleteEntry(m: MasterResume, entryId: string): Removal {
  const gone = m.entries.find((e) => e.entryId === entryId);
  if (!gone) return { master: m, removedFactIds: [], removedEntryIds: [] };
  const ids = [gone.heading.factId, ...(gone.subheading ? [gone.subheading.factId] : []), ...gone.bullets.map((b) => b.factId), ...gone.links.map((l) => l.factId)];
  return { master: { ...m, entries: m.entries.filter((e) => e.entryId !== entryId) }, removedFactIds: ids, removedEntryIds: [entryId] };
}

export type VariantCleanup = { variants: ResumeVariant[]; changed: { variantId: string; name: string }[]; warnings: string[] };

/** A deleted fact or entry is removed from every variant that referenced it, with a warning for each variant touched. */
export function cleanVariants(variants: ResumeVariant[], r: Pick<Removal, "removedFactIds" | "removedEntryIds">): VariantCleanup {
  const facts = new Set(r.removedFactIds);
  const entries = new Set(r.removedEntryIds);
  const changed: VariantCleanup["changed"] = [];
  const out = variants.map((v) => {
    const pinned = v.pinnedFactIds.filter((id) => !facts.has(id));
    const excluded = v.excludedFactIds.filter((id) => !facts.has(id));
    const order = v.entryOrder.filter((id) => !entries.has(id));
    const touched = pinned.length !== v.pinnedFactIds.length || excluded.length !== v.excludedFactIds.length || order.length !== v.entryOrder.length;
    if (touched) changed.push({ variantId: v.variantId, name: v.name });
    return touched ? { ...v, pinnedFactIds: pinned, excludedFactIds: excluded, entryOrder: order } : v;
  });
  return { variants: out, changed, warnings: changed.map((c) => `Removed from the "${c.name}" variant: it referenced content you deleted.`) };
}
