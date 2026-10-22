import { describe, expect, it } from "vitest";
import { parseResumeFile, confirmImport } from "@/resume/import";
import { MasterResumeSchema, type ParsedResume } from "@/resume/schema";
import { acceptFact, allDraftFacts, assignUnknownSection, canConfirm, editFactText, flaggedCount, removeEntry, removeFact, reviewBlocks, type Draft } from "@/options/resume/reviewState";
import { createResumeStore, type ResumeKV } from "@/resume/storage";
import { IDBFactory } from "fake-indexeddb";
import { buildScannedPdf, txtBytes } from "../../fixtures/resumes/files";
import { FIXED_NOW, testDeps } from "./helpers";

const opts = { ...testDeps, now: FIXED_NOW };
const enc = (s: string) => new TextEncoder().encode(s);

const MESSY = [
  "Sam Sample",
  "sam@example.test",
  "EXPERIENCE",
  "Example Co - Analyst    2024 - 2025",
  "- Did analysis",
  "SKILLS",
  "Python, SQL",
  "EXPERIENCE",
  "Other Co - Tester    2023 - 2024",
  "- Tested things",
  "HOBBIES",
  "Chess and running",
].join("\n");

async function messy(): Promise<{ parsed: ParsedResume; draft: Draft }> {
  const parsed = await parseResumeFile({ name: "m.txt", bytes: enc(MESSY) }, opts);
  return { parsed, draft: parsed.draft! };
}

describe("review state", () => {
  it("shows unknown sections first, then flagged blocks, then the rest in document order", async () => {
    const { parsed, draft } = await messy();
    const blocks = reviewBlocks(parsed, draft);
    expect(blocks[0]!.kind).toBe("unknown");
    const kinds = blocks.map((b) => (b.kind === "unknown" ? "U" : b.flagged ? "F" : "-")).join("");
    expect(kinds).toMatch(/^U+F*-*$/); // no flagged block after an unflagged one
    expect(blocks.filter((b) => b.flagged).map((b) => b.title)).toContain("Experience: Other Co - Tester");
    expect(flaggedCount(parsed, draft)).toBeGreaterThan(1);
  });

  it("editing a fact keeps its factId, changes the text, and clears its flag", async () => {
    const { draft } = await messy();
    const flagged = allDraftFacts(draft).find((f) => f.lowConfidence)!;
    const next = editFactText(draft, flagged.factId, "Reworded by the user");
    const after = allDraftFacts(next).find((f) => f.factId === flagged.factId)!;
    expect(after.text).toBe("Reworded by the user");
    expect(after.lowConfidence).toBe(false);
    expect(allDraftFacts(next).map((f) => f.factId)).toEqual(allDraftFacts(draft).map((f) => f.factId));
    expect(draft).not.toBe(next); // pure: a new object
    expect(allDraftFacts(draft).find((f) => f.factId === flagged.factId)!.text).toBe(flagged.text);
    expect(allDraftFacts(acceptFact(draft, flagged.factId)).find((f) => f.factId === flagged.factId)!.lowConfidence).toBe(false);
  });

  it("removes a bullet, a heading (whole entry), a skill and an entire entry", async () => {
    const { draft } = await messy();
    const e0 = draft.entries[0]!;
    const noBullet = removeFact(draft, e0.bullets[0]!.factId);
    expect(noBullet.entries[0]!.bullets).toHaveLength(0);
    expect(noBullet.entries).toHaveLength(draft.entries.length);
    const noEntry = removeFact(draft, e0.heading.factId);
    expect(noEntry.entries.map((e) => e.entryId)).not.toContain(e0.entryId);
    expect(removeEntry(draft, e0.entryId).entries).toHaveLength(draft.entries.length - 1);
    const skill = draft.skillGroups[0]!.items[0]!;
    expect(removeFact(draft, skill.factId).skillGroups[0]!.items.map((i) => i.text)).toEqual(["SQL"]);
    const onlyOne = removeFact(removeFact(draft, draft.skillGroups[0]!.items[0]!.factId), draft.skillGroups[0]!.items[1]!.factId);
    expect(onlyOne.skillGroups).toHaveLength(0); // empty group disappears
    // the name cannot be removed
    expect(removeFact(draft, draft.contact.name.factId).contact.name.text).toBe("Sam Sample");
    expect(removeFact(draft, draft.contact.email!.factId).contact.email).toBeUndefined();
  });

  it("assigning an unknown section adds its facts, flagged, and leaves the rest of the draft alone", async () => {
    const { parsed, draft } = await messy();
    const idx = parsed.sections.findIndex((s) => s.key === "unknown");
    const r = assignUnknownSection(parsed, draft, idx, "achievements", FIXED_NOW);
    expect(r.parsed.sections[idx]!.key).toBe("achievements");
    expect(r.draft.achievements.map((a) => a.text)).toEqual(["Chess and running"]);
    expect(r.draft.achievements[0]!.lowConfidence).toBe(true);
    expect(r.draft.entries).toEqual(draft.entries);
    expect(reviewBlocks(r.parsed, r.draft).some((b) => b.kind === "unknown")).toBe(false);
    // not an unknown section: no change
    expect(assignUnknownSection(parsed, draft, 0, "skills", FIXED_NOW).draft).toBe(draft);
  });

  it("Confirm is unavailable for a scanned PDF (no draft) and for no file", async () => {
    const scan = await parseResumeFile({ name: "s.pdf", bytes: await buildScannedPdf() }, opts);
    expect(canConfirm(scan, scan.draft)).toBe(false);
    expect(canConfirm(null, null)).toBe(false);
    expect(reviewBlocks(scan, scan.draft)).toEqual([]);
    const ok = await parseResumeFile({ name: "a.txt", bytes: txtBytes() }, opts);
    expect(canConfirm(ok, ok.draft)).toBe(true);
  });

  it("nothing is stored until confirm: parse + edit leave the store empty, confirm then putMaster stores it", async () => {
    const data: Record<string, unknown> = {};
    const kv: ResumeKV = {
      get: async (k) => (k in data ? { [k]: data[k] } : {}),
      set: async (i) => void Object.assign(data, i),
      remove: async (k) => void (Array.isArray(k) ? k : [k]).forEach((x) => delete data[x]),
    };
    const store = createResumeStore({ kv, idb: new IDBFactory() });
    const parsed = await parseResumeFile({ name: "a.txt", bytes: txtBytes() }, opts);
    const edited = editFactText(parsed.draft!, parsed.draft!.entries[0]!.bullets[0]!.factId, "My wording");
    expect(await store.getMaster()).toBeNull();
    expect(data).toEqual({});
    const master = confirmImport(edited, new Date("2026-04-01T00:00:00Z"));
    await store.putMaster(master);
    const back = await store.getMaster();
    expect(MasterResumeSchema.safeParse(back).success).toBe(true);
    expect(back!.entries[0]!.bullets[0]!.text).toBe("My wording");
    expect(back!.entries[0]!.bullets[0]!.provenance.source).toBe("resume_import_approved");
  });
});
