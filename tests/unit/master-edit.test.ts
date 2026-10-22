import { describe, expect, it } from "vitest";
import { allFacts, cleanVariants, deleteEntry, deleteFact, editFact } from "@/options/resume/masterEdit";
import { MasterResumeSchema } from "@/resume/schema";
import { defaultVariants } from "@/resume/variants";
import { sampleMaster } from "../fixtures/resumes";
import { deepFreeze } from "./resume-tailor/fixtures";

const NOW = new Date("2026-10-23T09:00:00Z");

describe("master editor (pure operations)", () => {
  const master = deepFreeze(sampleMaster()); // frozen: any in-place write throws
  const bullet = master.entries.find((e) => e.bullets.length > 0)!.bullets[0]!;

  it("editing a fact keeps its id, marks it user_edited with the time, and leaves the original master untouched", () => {
    const next = editFact(master, bullet.factId, "  Reworded by me  ", NOW);
    const f = allFacts(next).find((x) => x.factId === bullet.factId)!;
    expect(f.text).toBe("Reworded by me");
    expect(f.provenance).toMatchObject({ source: "user_edited", recordedAt: NOW.toISOString() });
    expect(allFacts(master).find((x) => x.factId === bullet.factId)!.text).toBe(bullet.text);
    expect(MasterResumeSchema.safeParse(next).success).toBe(true);
    expect(allFacts(next).filter((x) => x.provenance.source === "user_edited")).toHaveLength(1);
  });

  it("an empty edit is refused", () => {
    expect(() => editFact(master, bullet.factId, "   ", NOW)).toThrow(/empty/);
  });

  it("deleting a bullet removes just that fact; the name and entry headings cannot be deleted alone", () => {
    const r = deleteFact(master, bullet.factId);
    expect(r.removedFactIds).toEqual([bullet.factId]);
    expect(allFacts(r.master).some((x) => x.factId === bullet.factId)).toBe(false);
    expect(allFacts(r.master).length).toBe(allFacts(master).length - 1);
    expect(MasterResumeSchema.safeParse(r.master).success).toBe(true);
    expect(() => deleteFact(master, master.contact.name.factId)).toThrow(/name/);
    expect(() => deleteFact(master, master.entries[0]!.heading.factId)).toThrow(/heading/);
  });

  it("deleting a fact or an entry removes it from every variant that referenced it, with a warning per variant", () => {
    const variants = defaultVariants(master).map((v, i) => (i < 2 ? { ...v, pinnedFactIds: [...v.pinnedFactIds, bullet.factId], excludedFactIds: [...v.excludedFactIds, bullet.factId] } : v));
    const del = deleteFact(master, bullet.factId);
    const c = cleanVariants(variants, del);
    expect(c.changed).toHaveLength(2);
    expect(c.warnings).toHaveLength(2);
    for (const v of c.variants) {
      expect(v.pinnedFactIds).not.toContain(bullet.factId);
      expect(v.excludedFactIds).not.toContain(bullet.factId);
    }
    const entry = master.entries[0]!;
    const withEntry = defaultVariants(master).map((v) => ({ ...v, entryOrder: [...v.entryOrder, entry.entryId] }));
    const ed = deleteEntry(master, entry.entryId);
    expect(ed.master.entries.some((e) => e.entryId === entry.entryId)).toBe(false);
    expect(ed.removedFactIds).toContain(entry.heading.factId);
    const c2 = cleanVariants(withEntry, ed);
    expect(c2.variants.every((v) => !v.entryOrder.includes(entry.entryId))).toBe(true);
    expect(c2.changed.length).toBe(withEntry.length);
  });

  it("variants that reference nothing deleted are returned unchanged and produce no warning", () => {
    const v = defaultVariants(master);
    const c = cleanVariants(v, { removedFactIds: ["nope"], removedEntryIds: ["nope"] });
    expect(c.changed).toEqual([]);
    expect(c.variants).toEqual(v);
  });
});
