import type { Fact, MasterResume, ResumeVariant, SectionKey, TailoredLine, TailoredResume, TailoredSection } from "../schema";
import { TailoredResumeSchema } from "../schema";
import type { SelectedEntry, VariantSelection } from "../variants/apply";
import type { Relevance } from "./relevance";
import type { RewriteDecision } from "./rewrite";
import { probe, probeMentions } from "./terms";

export const SECTION_TITLES: Record<SectionKey, string> = {
  summary: "Summary",
  education: "Education",
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  certifications: "Certifications",
  achievements: "Achievements",
};

const lineId = (factId: string) => `l_${factId}`;
const displayUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");

type LineInit = Omit<TailoredLine, "protected" | "onlyEvidenceForRequiredQualification" | "relevance" | "origin"> &
  Partial<Pick<TailoredLine, "protected" | "onlyEvidenceForRequiredQualification" | "relevance" | "origin">>;
const line = (l: LineInit): TailoredLine => ({ protected: false, onlyEvidenceForRequiredQualification: false, relevance: 0.5, origin: "master", ...l });

function entryLines(se: SelectedEntry, rel: Relevance, decisions: Map<string, RewriteDecision>, protectedEntry: boolean): TailoredLine[] {
  const { entry, bullets } = se;
  const er = rel.entry.get(entry.entryId) ?? 0.5;
  const out: TailoredLine[] = [];
  out.push(line({ lineId: lineId(entry.heading.factId), role: "entry_heading", text: entry.heading.text, sourceFactIds: [entry.heading.factId], relevance: er, protected: protectedEntry }));
  if (entry.subheading) out.push(line({ lineId: lineId(entry.subheading.factId), role: "entry_subheading", text: entry.subheading.text, sourceFactIds: [entry.subheading.factId], relevance: er, protected: protectedEntry }));
  const meta = [entry.dates, entry.location].filter(Boolean).join(" | ");
  if (meta) out.push(line({ lineId: `m_${entry.entryId}`, role: "entry_meta", text: meta, sourceFactIds: [entry.heading.factId], relevance: er, protected: protectedEntry }));
  for (const b of bullets) {
    const d = decisions.get(b.factId);
    const rewritten = d?.status === "accepted";
    out.push(
      line({
        lineId: lineId(b.factId),
        role: "bullet",
        text: rewritten ? d.text : b.text,
        sourceFactIds: rewritten ? [b.factId, entry.heading.factId] : [b.factId],
        origin: rewritten ? "rewritten" : "master",
        ...(rewritten ? { masterText: b.text } : {}),
        relevance: rel.fact.get(b.factId) ?? 0.5,
      }),
    );
  }
  // At most two links, cited to the entry heading (the link records carry their own, separate, ids).
  entry.links.slice(0, 2).forEach((l, i) => out.push(line({ lineId: `k_${entry.entryId}_${i}`, role: "entry_meta", text: l.label || displayUrl(l.url), url: l.url, sourceFactIds: [entry.heading.factId], relevance: er * 0.5 })));
  return out;
}

function skillRows(selection: VariantSelection, rel: Relevance): TailoredEntrySkeleton[] {
  return selection.skillGroups.map((g) => {
    const rows: TailoredLine[] = [];
    for (let i = 0; i < g.items.length; i += 8) {
      const chunk = g.items.slice(i, i + 8);
      const relevance = Math.max(0.2, ...chunk.map((c) => rel.fact.get(c.factId) ?? 0));
      rows.push(line({ lineId: `sk_${g.groupId}_${i / 8}`, role: "skills_row", text: `${g.label}: ${chunk.map((c) => c.text).join(", ")}`, sourceFactIds: chunk.map((c) => c.factId), relevance }));
    }
    return { entryId: g.groupId, lines: rows };
  });
}
type TailoredEntrySkeleton = { entryId: string; lines: TailoredLine[] };

/** Builds the TailoredResume from the variant selection and the grounded rewrite decisions. Pure. */
export function assemble(args: {
  master: MasterResume;
  variant: ResumeVariant;
  selection: VariantSelection;
  rel: Relevance;
  decisions: Map<string, RewriteDecision>;
  requiredTerms: string[];
  masterHash: string;
  tailoredId: string;
  now: Date;
}): { tailored: TailoredResume; modifiedSections: SectionKey[] } {
  const { master, variant, selection, rel, decisions } = args;

  // ---- header: name and contact come from master.contact, never from a model ----
  const c = master.contact;
  const header: TailoredLine[] = [line({ lineId: lineId(c.name.factId), role: "name", text: c.name.text, sourceFactIds: [c.name.factId], relevance: 1, protected: true })];
  const facts = [c.email, c.phone, c.location].filter((f): f is Fact => Boolean(f));
  if (facts.length > 0) header.push(line({ lineId: "h_contact", role: "contact", text: facts.map((f) => f.text).join(" | "), sourceFactIds: facts.map((f) => f.factId), relevance: 1, protected: true }));
  for (const l of c.links) header.push(line({ lineId: lineId(l.fact.factId), role: "contact", text: displayUrl(l.url), url: l.url, sourceFactIds: [l.fact.factId], relevance: 1, protected: true }));

  // ---- the most relevant education entry is protected from the fit loop ----
  const edu = selection.entries.education;
  const topEdu = edu.length === 0 ? null : edu.reduce((a, b) => ((rel.entry.get(b.entry.entryId) ?? 0) > (rel.entry.get(a.entry.entryId) ?? 0) ? b : a));

  const sections: TailoredSection[] = [{ key: "header", title: "", entries: [{ entryId: "header", lines: header }] }];
  for (const key of selection.sectionOrder) {
    if (key === "summary" && selection.summary) {
      const s = selection.summary;
      sections.push({ key, title: SECTION_TITLES[key], entries: [{ entryId: "summary", lines: [line({ lineId: lineId(s.factId), role: "paragraph", text: s.text, sourceFactIds: [s.factId], relevance: 0.5 })] }] });
    } else if (key === "skills") {
      sections.push({ key, title: SECTION_TITLES[key], entries: skillRows(selection, rel) });
    } else if (key === "achievements") {
      const lines = selection.achievements.map((a) => line({ lineId: lineId(a.factId), role: "bullet", text: a.text, sourceFactIds: [a.factId], relevance: rel.fact.get(a.factId) ?? 0.3 }));
      sections.push({ key, title: SECTION_TITLES[key], entries: [{ entryId: "achievements", lines }] });
    } else if (key === "education" || key === "experience" || key === "projects" || key === "certifications") {
      const entries = selection.entries[key].map((se: SelectedEntry) => ({ entryId: se.entry.entryId, lines: entryLines(se, rel, decisions, se === topEdu) }));
      sections.push({ key, title: SECTION_TITLES[key], entries });
    }
  }

  // ---- sole evidence for a required qualification: the line is flagged and protected ----
  const content = sections.flatMap((s) => (s.key === "header" || s.key === "skills" || s.key === "summary" ? [] : s.entries.flatMap((e) => e.lines.filter((l) => l.role === "bullet"))));
  const probes = new Map(content.map((l) => [l, probe(l.text)]));
  for (const term of args.requiredTerms) {
    const evidencing = content.filter((l) => probeMentions(probes.get(l)!, term));
    if (evidencing.length === 1) {
      evidencing[0]!.onlyEvidenceForRequiredQualification = true;
      evidencing[0]!.protected = true;
    }
  }

  const modifiedSections = sections.filter((s) => s.key !== "header" && s.entries.some((e) => e.lines.some((l) => l.origin === "rewritten"))).map((s) => s.key as SectionKey);

  const tailored = TailoredResumeSchema.parse({
    tailoredId: args.tailoredId,
    masterId: master.masterId,
    masterHash: args.masterHash,
    variantId: variant.variantId,
    sections,
    createdAt: args.now.toISOString(),
  });
  return { tailored, modifiedSections };
}
