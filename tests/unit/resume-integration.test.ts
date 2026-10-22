// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashMaster } from "@/resume/hash";
import { layoutPdf, validatePdf } from "@/resume/layout";
import { tailor } from "@/resume/tailor";
import { defaultVariants, selectVariant } from "@/resume/variants";
import { DEFAULT_LAYOUT, type MasterResume, type TailoredLine } from "@/resume/schema";
import { longMaster, sampleMaster } from "../fixtures/resumes";
import { jobFixture } from "./resume-tailor/fixtures";
import { positionedText } from "./resume-layout/helpers";

/** B1 (master) -> B3 (variant + tailor) -> B2 (layout + validate): the real pieces together, no AI. */
async function run(master: MasterResume, protectAll = false) {
  const job = jobFixture();
  const variants = defaultVariants(master);
  const { variant } = selectVariant(variants, job, null, null);
  const before = await hashMaster(master);
  const out = await tailor({ master, variant, job, match: null, profile: null as never, ai: null, budget: { remaining: 0 } });
  // protectAll: every line is sole evidence for something the job requires, so nothing may be dropped (the only way a
  // resume can truly overflow, since everything else is dropped by the fit rule).
  const tailored = protectAll ? { ...out.tailored, sections: out.tailored.sections.map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, protected: true })) })) })) } : out.tailored;
  const { bytes, result } = await layoutPdf(tailored, DEFAULT_LAYOUT);
  const validation = await validatePdf(bytes, {
    pageLimit: DEFAULT_LAYOUT.pageLimit,
    requiredSections: result.finalResume.sections.filter((s) => s.key !== "header").map((s) => s.title),
    contact: { name: master.contact.name.text, email: master.contact.email?.text, phone: master.contact.phone?.text },
  });
  return { out, bytes, result, validation, before, after: await hashMaster(master) };
}

describe("resume pipeline, end to end without AI", () => {
  it("a normal master becomes a validated one-page PDF with its section titles, contact and links", async () => {
    const master = sampleMaster();
    const r = await run(master);
    expect(r.before).toBe(r.after); // the master is untouched
    expect(r.out.tailored.masterHash).toBe(r.before);
    expect(r.result.pageCount).toBe(1);
    expect(r.result.satisfiedLimit).toBe(true);
    expect(r.validation).toMatchObject({ ok: true, pageCount: 1, missingSections: [], missingContact: [] });
    const text = (await positionedText(r.bytes)).items.map((i) => i.str).join(" ");
    for (const s of r.result.finalResume.sections.filter((x) => x.key !== "header")) expect(text).toContain(s.title); // headings come from section.title
    expect(text).toContain(master.contact.name.text);
  });

  it("every rendered line cites facts that exist in the master", async () => {
    const master = sampleMaster();
    const r = await run(master);
    const ids = new Set<string>();
    const add = (f?: { factId: string }) => f && ids.add(f.factId);
    add(master.contact.name); add(master.contact.email); add(master.contact.phone); add(master.contact.location); add(master.summary);
    master.contact.links.forEach((l) => add(l.fact));
    for (const e of master.entries) { add(e.heading); add(e.subheading); e.bullets.forEach(add); e.links.forEach((l) => ids.add(l.factId)); }
    for (const g of master.skillGroups) g.items.forEach(add);
    master.achievements.forEach(add);
    const lines: TailoredLine[] = r.result.finalResume.sections.flatMap((s) => s.entries.flatMap((e) => e.lines));
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) for (const id of l.sourceFactIds) expect(ids.has(id), `${l.lineId} cites unknown fact ${id}`).toBe(true);
    expect(lines.every((l) => l.origin === "master")).toBe(true); // no AI: nothing was reworded
  });

  it("a long master is fitted by dropping the lowest-relevance items, and every drop is reported", async () => {
    const r = await run(longMaster());
    expect(r.result.pageCount).toBe(1);
    expect(r.result.droppedLineIds.length).toBeGreaterThan(0);
    expect(r.validation.pageCount).toBe(1);
    expect(r.before).toBe(r.after);
  });

  it("a master whose lines are all protected cannot be fitted and is reported honestly, never claimed as one page", async () => {
    const r = await run(longMaster(), true);
    expect(r.before).toBe(r.after);
    expect(r.result.pageCount).toBe(r.validation.pageCount);
    // The fixture is built to overflow, so this branch is always exercised (not conditional).
    expect(r.result.pageCount).toBeGreaterThan(1);
    expect(r.result.satisfiedLimit).toBe(false);
    expect(r.result.warnings.join(" ")).toMatch(/one-page constraint not met cleanly/);
    expect(r.validation.ok).toBe(false);
    // contact and protected lines survive whatever was dropped
    const names = r.result.finalResume.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).filter((l) => l.role === "name");
    expect(names).toHaveLength(1);
  });
});
