import { describe, expect, it } from "vitest";
import { ResumeVariantSchema, SECTION_KEYS, type ResumeVariant } from "@/resume/schema";
import { applyVariant, defaultVariants, selectVariant } from "@/resume/variants";
import {
  blankVariant, factMode, factOptions, moveItem, parseKeywords, setFactMode, setLimit, staleIds, toggleEntry, toggleSection, uniqueVariantId, validateVariant, variantFromDefault,
} from "@/options/variants/editing";
import { jobFixture, masterFixture, deepFreeze, variantFixture } from "./fixtures";
import { fakeStore } from "./fake-store";

const v = (id: string, name: string, roleKeywords: string[]): ResumeVariant => variantFixture({ variantId: id, name, roleKeywords });

describe("selectVariant (SPEC 7.2)", () => {
  const variants = [v("data-scientist", "Data Scientist", ["data scientist", "statistics"]), v("ai-ml", "AI/ML Engineer", ["machine learning", "pytorch"]), v("swe", "Software Engineer", ["software engineer", "backend"])];

  it("a preferred id always wins and is not 'auto'", () => {
    const r = selectVariant(variants, jobFixture({ jobTitle: "Machine Learning Intern" }), null, "swe");
    expect(r.variant.variantId).toBe("swe");
    expect(r.auto).toBe(false);
  });

  it("an unknown preferred id falls back to automatic selection", () => {
    expect(selectVariant(variants, jobFixture(), null, "gone")).toMatchObject({ auto: true });
  });

  it("selects automatically from title keywords", () => {
    expect(selectVariant(variants, jobFixture({ jobTitle: "Machine Learning Intern" }), null, null)).toMatchObject({ auto: true, variant: { variantId: "ai-ml" } });
    expect(selectVariant(variants, jobFixture({ jobTitle: "Backend Software Engineer", requiredSkills: [], preferredSkills: [], relevantKeywords: [], descriptionText: "Build APIs." }), null, null).variant.variantId).toBe("swe");
    expect(selectVariant(variants, jobFixture({ jobTitle: "Data Scientist Intern", requiredSkills: [], preferredSkills: [], relevantKeywords: [], descriptionText: "Analyse." }), null, null).variant.variantId).toBe("data-scientist");
  });

  it("uses the Phase 5 match and posting skills when the title is neutral", () => {
    const job = jobFixture({ jobTitle: "Intern", requiredSkills: ["PyTorch"], preferredSkills: [], relevantKeywords: [] });
    expect(selectVariant(variants, job, null, null).variant.variantId).toBe("ai-ml");
  });

  it("breaks ties deterministically (variantId ascending), whatever order the store lists them in", () => {
    const tied = [v("b-variant", "B", ["xyz"]), v("a-variant", "A", ["xyz"]), v("c-variant", "C", ["xyz"])];
    const job = jobFixture({ jobTitle: "Intern", requiredSkills: [], preferredSkills: [], relevantKeywords: [], descriptionText: "Nothing relevant." });
    const forward = selectVariant(tied, job, null, null).variant.variantId;
    const backward = selectVariant([...tied].reverse(), job, null, null).variant.variantId;
    expect(forward).toBe("a-variant");
    expect(backward).toBe(forward);
  });

  it("throws only when there is no variant at all", () => {
    expect(() => selectVariant([], jobFixture(), null, null)).toThrow();
  });
});

describe("defaultVariants", () => {
  const master = masterFixture();
  const defaults = defaultVariants(master);

  it("provides the starter variants as valid rules over ids, with no fact text copied", () => {
    expect(defaults.map((d) => d.name)).toEqual(expect.arrayContaining(["AI/ML Engineer", "Data Scientist", "Software Engineer", "Generative AI Engineer", "Research Internship"]));
    for (const d of defaults) expect(() => ResumeVariantSchema.parse(d)).not.toThrow();
    const json = JSON.stringify(defaults);
    for (const e of master.entries) for (const b of e.bullets) expect(json).not.toContain(b.text);
    const ids = new Set([...master.entries.map((e) => e.entryId)]);
    for (const d of defaults) for (const id of d.entryOrder) expect(ids.has(id)).toBe(true);
    expect(new Set(defaults.map((d) => d.variantId)).size).toBe(defaults.length);
  });

  it("ranks entries by role: the ML variant lists the PyTorch project before the course parser; nothing mutates the master", () => {
    const frozen = deepFreeze(masterFixture());
    const ml = defaultVariants(frozen).find((d) => d.variantId === "ai-ml-engineer")!;
    expect(ml.entryOrder.indexOf("proj1")).toBeLessThan(ml.entryOrder.indexOf("proj2"));
    expect(ml.entryOrder.indexOf("edu1")).toBeLessThan(ml.entryOrder.indexOf("exp1")); // sections stay grouped
  });
});

describe("applyVariant", () => {
  const master = deepFreeze(masterFixture());
  const bulletIds = (sel: ReturnType<typeof applyVariant>, section: "experience" | "projects" | "education", entryId: string) =>
    sel.entries[section].find((e) => e.entry.entryId === entryId)?.bullets.map((b) => b.factId);

  it("honours excluded facts, pinned facts and the bullet cap (pinned first, never cut)", () => {
    const sel = applyVariant(master, variantFixture({ excludedFactIds: ["exp1_b1"], pinnedFactIds: ["proj1_b2"], limits: { maxProjects: 3, maxExperience: 3, maxBulletsPerEntry: 1 } }));
    expect(bulletIds(sel, "experience", "exp1")).toEqual(["exp1_b2"]);
    expect(bulletIds(sel, "projects", "proj1")).toEqual(["proj1_b2"]); // pinned beats master order, cap of 1
    expect(sel.dropped).toEqual(expect.arrayContaining([{ factId: "exp1_b1", reason: "excluded by the variant" }, { factId: "proj1_b1", reason: "over the variant's bullet limit" }]));
  });

  it("pinned facts survive even when they exceed the cap", () => {
    const sel = applyVariant(master, variantFixture({ pinnedFactIds: ["proj1_b1", "proj1_b2"], limits: { maxProjects: 3, maxExperience: 3, maxBulletsPerEntry: 1 } }));
    expect(bulletIds(sel, "projects", "proj1")).toEqual(["proj1_b1", "proj1_b2"]);
  });

  it("an excluded entry heading removes the entry", () => {
    const sel = applyVariant(master, variantFixture({ excludedFactIds: ["proj2_h"] }));
    expect(sel.entries.projects.map((e) => e.entry.entryId)).toEqual(["proj1", "proj3"]);
  });

  it("applies entry limits in the variant's order and reports what was cut", () => {
    const sel = applyVariant(master, variantFixture({ entryOrder: ["proj3", "proj1", "proj2"], limits: { maxProjects: 2, maxExperience: 3, maxBulletsPerEntry: 4 } }));
    expect(sel.entries.projects.map((e) => e.entry.entryId)).toEqual(["proj3", "proj1"]);
    expect(sel.dropped.some((d) => d.factId === "proj2_h")).toBe(true);
    expect(applyVariant(master, variantFixture({ limits: { maxProjects: 0, maxExperience: 0, maxBulletsPerEntry: 1 } })).entries.experience).toEqual([]);
  });

  it("an empty entryOrder means everything in master order; an explicit one lists only those entries", () => {
    expect(applyVariant(master, variantFixture({ entryOrder: [] })).entries.projects.map((e) => e.entry.entryId)).toEqual(["proj1", "proj2", "proj3"]);
    expect(applyVariant(master, variantFixture({ entryOrder: ["proj2"] })).entries.projects.map((e) => e.entry.entryId)).toEqual(["proj2"]);
  });

  it("sectionOrder decides which sections appear and in which order; empty sections are skipped", () => {
    const sel = applyVariant(master, variantFixture({ sectionOrder: ["skills", "projects", "education"] }));
    expect(sel.sectionOrder).toEqual(["skills", "projects", "education"]);
    expect(sel.summary).toBeNull();
    expect(sel.entries.experience).toEqual([]);
    const noSkills = applyVariant(master, variantFixture({ sectionOrder: ["projects"], excludedFactIds: [] }));
    expect(noSkills.sectionOrder).toEqual(["projects"]);
  });

  it("skillGroupOrder lists groups first; excluded skills disappear; scoring reorders unpinned skills", () => {
    const sel = applyVariant(master, variantFixture({ skillGroupOrder: ["g_tools", "g_ml"], excludedFactIds: ["sk_sk"], pinnedFactIds: ["sk_sql"] }));
    expect(sel.skillGroups.map((g) => g.groupId)).toEqual(["g_tools", "g_ml", "g_lang"]);
    expect(sel.skillGroups.find((g) => g.groupId === "g_ml")!.items.map((i) => i.text)).toEqual(["PyTorch"]);
    expect(sel.skillGroups.find((g) => g.groupId === "g_lang")!.items.map((i) => i.text)).toEqual(["SQL", "Python", "Java"]);
    const scored = applyVariant(master, variantFixture(), { score: { fact: (id) => (id === "sk_java" ? 1 : 0), entry: () => 0 } });
    expect(scored.skillGroups.find((g) => g.groupId === "g_lang")!.items[0]!.text).toBe("Java");
  });

  it("never mutates the (frozen) master and returns fresh arrays", () => {
    const sel = applyVariant(master, variantFixture());
    expect(sel.entries.projects).not.toBe(master.entries);
    expect(() => applyVariant(master, variantFixture({ pinnedFactIds: ["exp1_b2"], excludedFactIds: ["exp1_b1"] }), { score: { fact: () => 0.5, entry: () => 0.5 }, fillUnlistedAtLeast: 0.1 })).not.toThrow();
  });

  it("with scores, unlisted relevant entries fill free slots and projects order by relevance", () => {
    const score = { fact: () => 0.5, entry: (id: string) => ({ proj3: 0.9, proj1: 0.6, proj2: 0.4 })[id] ?? 0.5 };
    const sel = applyVariant(master, variantFixture({ entryOrder: ["proj2"], limits: { maxProjects: 2, maxExperience: 3, maxBulletsPerEntry: 4 } }), { score, fillUnlistedAtLeast: 0.5 });
    expect(sel.entries.projects.map((e) => e.entry.entryId)).toEqual(["proj3", "proj1"]);
  });
});

describe("variant editing logic and the CRUD flow against an in-memory store", () => {
  const master = masterFixture();

  it("creates blank and default-based variants with unique ids", () => {
    const a = blankVariant("My variant", [], master);
    expect(a).toMatchObject({ variantId: "my-variant", name: "My variant", sectionOrder: [...SECTION_KEYS] });
    expect(a.entryOrder).toEqual(master.entries.map((e) => e.entryId));
    expect(uniqueVariantId("My variant", ["my-variant", "my-variant-2"])).toBe("my-variant-3");
    const d = variantFromDefault(master, "ai-ml-engineer", ["ai-ml-engineer"])!;
    expect(d.variantId).toBe("ai-ml-engineer-2");
    expect(variantFromDefault(master, "nope", [])).toBeNull();
    expect(ResumeVariantSchema.safeParse(a).success).toBe(true);
  });

  it("edits keywords, order, pinned/excluded facts and limits without mutating the input", () => {
    const base = Object.freeze(blankVariant("X", [], master));
    expect(parseKeywords(" ML, data ,, ML\nNLP ")).toEqual(["ML", "data", "NLP"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    const pinned = setFactMode(base, "exp1_b1", "pinned");
    expect(factMode(pinned, "exp1_b1")).toBe("pinned");
    const excl = setFactMode(pinned, "exp1_b1", "excluded");
    expect(excl.pinnedFactIds).toEqual([]);
    expect(factMode(excl, "exp1_b1")).toBe("excluded");
    expect(factMode(setFactMode(excl, "exp1_b1", "normal"), "exp1_b1")).toBe("normal");
    expect(toggleSection(base, "projects").sectionOrder).not.toContain("projects");
    expect(toggleEntry(base, "proj1").entryOrder).not.toContain("proj1");
    expect(setLimit(base, "maxBulletsPerEntry", 99).limits.maxBulletsPerEntry).toBe(12);
    expect(setLimit(base, "maxProjects", -3).limits.maxProjects).toBe(0);
    expect(base.pinnedFactIds).toEqual([]);
  });

  it("offers the master's facts for selection and flags ids that no longer exist", () => {
    const options = factOptions(master);
    expect(options.find((o) => o.factId === "exp1_b1")?.context).toBe("Data Intern, Acme Labs");
    expect(options.some((o) => o.factId === "c_email")).toBe(false); // contact details are never selectable
    const v1 = { ...blankVariant("X", [], master), pinnedFactIds: ["ghost_fact"], entryOrder: ["proj1", "ghost_entry"] };
    expect(staleIds(v1, master).sort()).toEqual(["ghost_entry", "ghost_fact"]);
  });

  it("validates names and structure", () => {
    const other = blankVariant("Taken", [], master);
    expect(validateVariant({ ...blankVariant("A", [], master), name: "  " }, [])).toContain("Give the variant a name");
    expect(validateVariant({ ...blankVariant("taken", ["taken"], master), name: "TAKEN" }, [other])).toContain("Another variant already has this name");
    expect(validateVariant(blankVariant("Fine", [], master), [other])).toEqual([]);
  });

  it("list / create / edit / delete through the ResumeStore interface", async () => {
    const store = fakeStore({ master });
    expect(await store.listVariants()).toEqual([]);
    for (const d of defaultVariants(master).slice(0, 2)) await store.putVariant(d);
    const created = blankVariant("Mine", (await store.listVariants()).map((x) => x.variantId), await store.getMaster());
    await store.putVariant(created);
    let list = await store.listVariants();
    expect(list.map((x) => x.name)).toContain("Mine");
    const edited = setFactMode({ ...created, name: "Mine v2", roleKeywords: parseKeywords("rag, llm") }, "proj1_b2", "excluded");
    expect(validateVariant(edited, list)).toEqual([]);
    await store.putVariant(edited);
    list = await store.listVariants();
    const saved = list.find((x) => x.variantId === created.variantId)!;
    expect(saved).toMatchObject({ name: "Mine v2", roleKeywords: ["rag", "llm"], excludedFactIds: ["proj1_b2"] });
    await store.deleteVariant(created.variantId);
    expect((await store.listVariants()).some((x) => x.variantId === created.variantId)).toBe(false);
    expect((await store.getMaster())!.masterId).toBe(master.masterId); // variants never touch the master
  });
});
