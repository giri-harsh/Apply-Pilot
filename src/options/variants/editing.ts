import { ResumeVariantSchema, SECTION_KEYS, type MasterResume, type ResumeVariant, type SectionKey } from "@/resume/schema";
import { defaultVariants } from "@/resume/variants/defaults";

/**
 * Pure editing logic behind the variants panel (SPEC 7.2). A variant is a rule over the master's ids: nothing here
 * ever copies fact text into a variant, and nothing mutates its input (every function returns a new variant).
 */

export type FactMode = "normal" | "pinned" | "excluded";
export type FactOption = { factId: string; label: string; context: string };
export type EntryOption = { entryId: string; section: SectionKey; label: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The master's facts a variant can pin or exclude (display text only; the variant stores just the ids). */
export function factOptions(master: MasterResume): FactOption[] {
  const out: FactOption[] = [];
  if (master.summary) out.push({ factId: master.summary.factId, label: clip(master.summary.text, 90), context: "Summary" });
  for (const e of master.entries) {
    out.push({ factId: e.heading.factId, label: clip(e.heading.text, 90), context: `${e.section} (entry)` });
    for (const b of e.bullets) out.push({ factId: b.factId, label: clip(b.text, 90), context: e.heading.text });
  }
  for (const g of master.skillGroups) for (const it of g.items) out.push({ factId: it.factId, label: it.text, context: `Skills: ${g.label}` });
  for (const a of master.achievements) out.push({ factId: a.factId, label: clip(a.text, 90), context: "Achievements" });
  return out;
}

export const entryOptions = (master: MasterResume): EntryOption[] => master.entries.map((e) => ({ entryId: e.entryId, section: e.section, label: clip(e.heading.text, 80) }));

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "variant";

export function uniqueVariantId(name: string, existingIds: string[]): string {
  const base = slugify(name);
  if (!existingIds.includes(base)) return base;
  for (let n = 2; n < 1000; n++) if (!existingIds.includes(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${existingIds.length + 1}`;
}

/** A new variant listing every master entry in master order and every section. */
export function blankVariant(name: string, existingIds: string[], master: MasterResume | null): ResumeVariant {
  const clean = name.trim() || "New variant";
  return {
    variantId: uniqueVariantId(clean, existingIds),
    name: clean.slice(0, 80),
    roleKeywords: [],
    sectionOrder: [...SECTION_KEYS],
    entryOrder: master ? master.entries.map((e) => e.entryId) : [],
    pinnedFactIds: [],
    excludedFactIds: [],
    skillGroupOrder: master ? master.skillGroups.map((g) => g.groupId) : [],
    limits: { maxProjects: 4, maxExperience: 3, maxBulletsPerEntry: 4 },
  };
}

/** A copy of one of the starter variants under a fresh id (so editing it never touches the starter rule). */
export function variantFromDefault(master: MasterResume, defaultId: string, existingIds: string[]): ResumeVariant | null {
  const d = defaultVariants(master).find((v) => v.variantId === defaultId);
  if (!d) return null;
  return { ...d, variantId: uniqueVariantId(d.name, existingIds) };
}

export const parseKeywords = (raw: string): string[] => [...new Set(raw.split(/[,\n]/).map((k) => k.trim()).filter(Boolean))].slice(0, 30).map((k) => k.slice(0, 60));

export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

export function toggleSection(v: ResumeVariant, key: SectionKey): ResumeVariant {
  return { ...v, sectionOrder: v.sectionOrder.includes(key) ? v.sectionOrder.filter((k) => k !== key) : [...v.sectionOrder, key] };
}

export const moveSection = (v: ResumeVariant, index: number, delta: -1 | 1): ResumeVariant => ({ ...v, sectionOrder: moveItem(v.sectionOrder, index, delta) });

export function toggleEntry(v: ResumeVariant, entryId: string): ResumeVariant {
  return { ...v, entryOrder: v.entryOrder.includes(entryId) ? v.entryOrder.filter((k) => k !== entryId) : [...v.entryOrder, entryId] };
}

export const moveEntry = (v: ResumeVariant, index: number, delta: -1 | 1): ResumeVariant => ({ ...v, entryOrder: moveItem(v.entryOrder, index, delta) });

export const factMode = (v: ResumeVariant, factId: string): FactMode => (v.excludedFactIds.includes(factId) ? "excluded" : v.pinnedFactIds.includes(factId) ? "pinned" : "normal");

/** A fact is pinned, excluded or neither, never both. */
export function setFactMode(v: ResumeVariant, factId: string, mode: FactMode): ResumeVariant {
  const pinned = v.pinnedFactIds.filter((f) => f !== factId);
  const excluded = v.excludedFactIds.filter((f) => f !== factId);
  if (mode === "pinned") pinned.push(factId);
  if (mode === "excluded") excluded.push(factId);
  return { ...v, pinnedFactIds: pinned, excludedFactIds: excluded };
}

export function setLimit(v: ResumeVariant, key: keyof ResumeVariant["limits"], value: number): ResumeVariant {
  const max = key === "maxBulletsPerEntry" ? 12 : 20;
  const min = key === "maxBulletsPerEntry" ? 1 : 0;
  const n = Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
  return { ...v, limits: { ...v.limits, [key]: n } };
}

/** Ids in a variant that no longer exist in the master (after the master was edited). They are ignored when applying. */
export function staleIds(v: ResumeVariant, master: MasterResume): string[] {
  const facts = new Set(factOptions(master).map((f) => f.factId));
  const entries = new Set(master.entries.map((e) => e.entryId));
  return [...v.pinnedFactIds.filter((f) => !facts.has(f)), ...v.excludedFactIds.filter((f) => !facts.has(f)), ...v.entryOrder.filter((e) => !entries.has(e))];
}

/** Human-readable problems; empty when the variant can be saved. */
export function validateVariant(v: ResumeVariant, others: ResumeVariant[]): string[] {
  const errors: string[] = [];
  if (v.name.trim().length === 0) errors.push("Give the variant a name");
  if (others.some((o) => o.variantId !== v.variantId && o.name.trim().toLowerCase() === v.name.trim().toLowerCase())) errors.push("Another variant already has this name");
  const parsed = ResumeVariantSchema.safeParse(v);
  if (!parsed.success) for (const i of parsed.error.issues.slice(0, 3)) errors.push(`${i.path.join(".") || "variant"}: ${i.message}`);
  return errors;
}
