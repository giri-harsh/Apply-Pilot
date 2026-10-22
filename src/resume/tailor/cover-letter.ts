import type { EvidenceItem } from "@/answers/evidence";
import type { AnswerClaim } from "@/answers/grounding";
import type { CoverLetterFn } from "../contracts";
import { assertMasterUnchanged, hashMaster } from "../hash";
import { TailoredResumeSchema, type Fact, type MasterEntry, type TailoredLine, type TailoredResume } from "../schema";
import { aiUsable, ask, newRun } from "./ai";
import { allowedOrgsFor, bundleOf, entryTechnologies, itemForBullet, itemForPlainFacts } from "./evidence-from-master";
import { buildCoverPrompt, COVER_JSON_SCHEMA, CoverEnvelopeSchema, CoverItemSchema, regenerationNote, type CoverItem } from "./prompt";
import { computeRelevance } from "./relevance";
import { checkText, violationStrings, type TailorViolation } from "./rules";
import { allJobTerms, buildJobTerms } from "./terms";

type Source = { item: EvidenceItem; factIds: string[]; entry: MasterEntry | null; texts: string[]; tech: string[] };

/**
 * Cover letter (default OFF; called only when a portal requires one). Same facts, same validator, category
 * "cover_letter". One request, at most one regeneration listing the exact violations; if the letter still fails it is
 * not produced (null). Nothing is invented, and an unavailable AI also gives null.
 */
export const generateCoverLetter: CoverLetterFn = async ({ master, job, ai, budget }) => {
  const usable = aiUsable(ai, budget);
  if (!usable.ok) return null;
  const masterHash = await hashMaster(master);
  const terms = buildJobTerms(job);
  const rel = computeRelevance(master, terms, null);
  const run = newRun();

  // ---- evidence: the three most relevant experience/project entries (3 best bullets each), one education entry, the skills ----
  const sources = new Map<string, Source>();
  const add = (item: EvidenceItem, factIds: string[], entry: MasterEntry | null, texts: string[], tech: string[]) => sources.set(item.id, { item, factIds, entry, texts, tech });
  const entries = master.entries
    .filter((e) => e.section === "experience" || e.section === "projects")
    .map((e, i) => ({ e, i, s: rel.entry.get(e.entryId) ?? 0 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.e);
  const edu = master.entries.find((e) => e.section === "education");
  let n = 0;
  const bulletsOf = (e: MasterEntry): Fact[] => [...e.bullets].sort((a, b) => (rel.fact.get(b.factId) ?? 0) - (rel.fact.get(a.factId) ?? 0)).slice(0, 3);
  for (const e of [...entries, ...(edu ? [edu] : [])]) {
    for (const b of bulletsOf(e)) {
      const id = `c${++n}`;
      add(itemForBullet(id, e, b, true), [b.factId, e.heading.factId], e, [`${e.heading.text}: ${b.text}`], entryTechnologies(e));
    }
  }
  const skills = master.skillGroups.flatMap((g) => g.items).sort((a, b) => (rel.fact.get(b.factId) ?? 0) - (rel.fact.get(a.factId) ?? 0)).slice(0, 8);
  if (skills.length > 0) add(itemForPlainFacts(`c${n + 1}`, "skills", "Skills", skills), skills.map((s) => s.factId), null, [skills.map((s) => s.text).join(", ")], []);
  if (sources.size === 0) return null;

  const items = [...sources.values()].map((s) => s.item);
  const orgs = [...new Set([...(job.company ? [job.company] : []), ...[...sources.values()].flatMap((s) => allowedOrgsFor(s.entry, s.texts))])];
  const bundle = bundleOf(items, orgs, []); // a letter body never contains links
  const sentIds = items.map((i) => i.id);
  const jobTerms = allJobTerms(terms);

  const request = async (extra?: string) => {
    const prompt = buildCoverPrompt(job, items.map((i) => ({ id: i.id, kind: i.kind, text: i.text })), extra);
    const out = await ask(usable.ai, budget, run, { category: "cover_letter", system: prompt.system, user: prompt.user, schema: CoverEnvelopeSchema, jsonSchema: COVER_JSON_SCHEMA, schemaName: "cover_letter", maxOutputTokens: 3500 });
    if (!out.ok) return null;
    const paragraphs: CoverItem[] = [];
    for (const raw of out.data.paragraphs) {
      const p = CoverItemSchema.safeParse(raw);
      if (p.success) paragraphs.push(p.data);
    }
    return paragraphs;
  };

  const validate = (paragraphs: CoverItem[]): Record<number, TailorViolation[]> => {
    const bad: Record<number, TailorViolation[]> = {};
    if (paragraphs.length === 0) bad[0] = [{ rule: "missing_item", detail: "The model returned no paragraphs" }];
    paragraphs.forEach((p, i) => {
      const cited = p.evidenceIds.filter((id) => sources.has(id));
      const src = cited.map((id) => sources.get(id)!);
      const v = checkText({
        text: p.text.trim(), claims: p.claims as AnswerClaim[], cited, sentIds, bundle,
        sourceText: src.flatMap((s) => s.texts).join("\n"), entryTech: src.flatMap((s) => s.tech), jobTerms,
      });
      if (p.text.trim().length < 40) v.push({ rule: "empty_answer", detail: "The paragraph is too short to be a paragraph" });
      if (v.length > 0) bad[i] = v;
    });
    return bad;
  };

  let paragraphs = await request();
  if (!paragraphs) return null;
  let bad = validate(paragraphs);
  if (Object.keys(bad).length > 0) {
    if (budget.remaining <= 0) return null;
    const note = regenerationNote(Object.fromEntries(Object.entries(bad).map(([i, v]) => [`paragraph ${Number(i) + 1}`, violationStrings(v)])));
    paragraphs = await request(`${note}\nRewrite the whole letter body.`);
    if (!paragraphs) return null;
    bad = validate(paragraphs);
    if (Object.keys(bad).length > 0) return null;
  }

  const lines: TailoredLine[] = paragraphs.map((p, i) => {
    const ids = [...new Set(p.evidenceIds.filter((id) => sources.has(id)).flatMap((id) => sources.get(id)!.factIds))].slice(0, 8);
    return { lineId: `cl_${i + 1}`, role: "paragraph", text: p.text.trim(), sourceFactIds: ids, origin: "rewritten", relevance: 1, protected: true, onlyEvidenceForRequiredQualification: false };
  });
  const letter: TailoredResume = TailoredResumeSchema.parse({
    tailoredId: `cl_${masterHash.slice(0, 8)}_${Date.now().toString(36)}`,
    masterId: master.masterId,
    masterHash,
    variantId: "cover_letter",
    sections: [{ key: "summary", title: "Cover letter", entries: [{ entryId: "cover_letter", lines }] }],
    createdAt: new Date().toISOString(),
  });
  await assertMasterUnchanged(master, masterHash);
  return letter;
};
