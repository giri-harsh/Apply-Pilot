import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { confirmImport, DEFAULT_IMPORT_MAX_BYTES, NO_TEXT_PDF_WARNING, parseResume, parseResumeFile } from "@/resume/import";
import { MasterResumeSchema, ParsedResumeSchema, type Fact, type MasterResume, type ParsedResume } from "@/resume/schema";
import { buildDocx, buildEmptyDocx, buildScannedPdf, buildTextPdf, buildTwoColumnPdf, mdBytes, txtBytes } from "../../fixtures/resumes/files";
import { longMaster, sampleMaster } from "../../fixtures/resumes";
import { FIXED_NOW, testDeps } from "./helpers";

type Draft = NonNullable<ParsedResume["draft"]>;
const opts = { ...testDeps, now: FIXED_NOW };
const enc = (s: string) => new TextEncoder().encode(s);

const allFacts = (d: Draft | MasterResume): Fact[] => [
  d.contact.name,
  ...(d.contact.email ? [d.contact.email] : []),
  ...(d.contact.phone ? [d.contact.phone] : []),
  ...(d.contact.location ? [d.contact.location] : []),
  ...d.contact.links.map((l) => l.fact),
  ...(d.summary ? [d.summary] : []),
  ...d.entries.flatMap((e) => [e.heading, ...(e.subheading ? [e.subheading] : []), ...e.bullets]),
  ...d.skillGroups.flatMap((g) => g.items),
  ...d.achievements,
];

async function allFormats(): Promise<[string, Uint8Array][]> {
  return [
    ["alex-example.txt", txtBytes()],
    ["alex-example.md", mdBytes()],
    ["alex-example.docx", await buildDocx()],
    ["alex-example.pdf", await buildTextPdf()],
  ];
}

describe("section detection on every format", () => {
  it.each(["txt", "md", "docx", "pdf"])("%s: finds contact, education, experience, projects, skills, certifications (+ summary)", async (ext) => {
    const [name, bytes] = (await allFormats()).find(([n]) => n.endsWith(`.${ext}`))!;
    const p = await parseResumeFile({ name, bytes }, opts);
    expect(ParsedResumeSchema.safeParse(p).success).toBe(true);
    expect(p.format).toBe(ext);
    expect(p.hasExtractableText).toBe(true);
    expect(p.sections.map((s) => s.key)).toEqual(["contact", "summary", "education", "experience", "projects", "skills", "certifications"]);
    for (const s of p.sections) {
      expect(s.confidence).toBeGreaterThanOrEqual(0.6);
      expect(s.sourceText.length).toBeGreaterThan(0);
    }
    expect(p.warnings).toEqual([]);
    expect(p.sourceText).toContain("Alex Example");

    const d = p.draft!;
    expect(d.contact.name.text).toBe("Alex Example");
    expect(d.contact.email?.text).toBe("alex.example@example.test");
    expect(d.contact.phone?.text).toBe("+1 555 010 0199");
    expect(d.contact.location?.text).toBe("Springfield, USA");
    expect(d.contact.links.map((l) => l.label)).toEqual(["LinkedIn", "GitHub"]);
    expect(d.summary?.text).toMatch(/computer science student/);
    const by = (k: string) => d.entries.filter((e) => e.section === k);
    expect(by("education")).toHaveLength(1);
    expect(by("education")[0]!.heading.text).toBe("Springfield Institute of Technology");
    expect(by("education")[0]!.dates).toBe("2022 - 2026");
    expect(by("education")[0]!.bullets.map((b) => b.text)).toContain("CGPA: 8.7/10");
    expect(by("experience").map((e) => e.heading.text)).toEqual(["Acme Labs - Data Science Intern", "Bright Works - Research Assistant"]);
    expect(by("experience")[0]!.dates).toBe("Jun 2025 - Aug 2025");
    expect(by("experience")[0]!.bullets).toHaveLength(2);
    expect(by("projects").map((e) => e.heading.text)).toEqual(["Sales Forecaster", "Resume Parser", "Campus Event Finder"]);
    expect(by("projects")[0]!.technologies).toEqual(["Python", "pandas", "scikit-learn"]);
    expect(by("projects")[0]!.bullets).toHaveLength(2);
    expect(by("certifications").map((e) => e.heading.text)).toEqual(["Google Data Analytics Certificate", "Deep Learning Specialization"]);
    expect(by("certifications")[0]!.dates).toBe("2024");
    expect(d.skillGroups.map((g) => g.label)).toEqual(["Languages", "Machine learning", "Tools"]);
    expect(d.skillGroups[1]!.items.map((i) => i.text)).toEqual(["scikit-learn", "PyTorch (basics)", "pandas"]);
    expect(d.importedFrom).toEqual({ filename: name, format: ext, importedAt: FIXED_NOW.toISOString() });
    // facts carry source text, provenance and no flags for a clean file
    for (const f of allFacts(d)) {
      expect(f.provenance.source).toBe("resume_import_approved");
      expect(f.provenance.note).toBe(`parsed from ${name}; not yet confirmed`);
      expect(f.provenance.recordedAt).toBe(FIXED_NOW.toISOString());
      expect(f.sourceText && f.sourceText.length).toBeGreaterThan(0);
      expect(f.lowConfidence).toBe(false);
    }
  });

  it("recognises heading synonyms", async () => {
    const txt = [
      "Sam Sample",
      "sam@example.test",
      "Professional Experience",
      "Example Co - Analyst    2024 - 2025",
      "- Did analysis",
      "Technical Projects",
      "Thing",
      "- Made a thing",
      "Licenses & Certifications",
      "Cert One",
      "Academic Background",
      "Example University    2020 - 2024",
      "Skills & Tools",
      "Python, SQL",
      "Honors and Awards",
      "- Dean's list",
    ].join("\n");
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    expect(p.sections.map((s) => s.key)).toEqual(["contact", "experience", "projects", "certifications", "education", "skills", "achievements"]);
    expect(p.draft!.achievements.map((a) => a.text)).toEqual(["Dean's list"]);
    expect(p.draft!.skillGroups[0]!.items.map((i) => i.text)).toEqual(["Python", "SQL"]);
  });
});

describe("pdf text order and docx structure", () => {
  it("PDF text keeps reading order (headings appear top to bottom)", async () => {
    const p = await parseResumeFile({ name: "a.pdf", bytes: await buildTextPdf() }, opts);
    const order = ["Alex Example", "SUMMARY", "EDUCATION", "WORK EXPERIENCE", "Acme Labs", "ACADEMIC PROJECTS", "Sales Forecaster", "TECHNICAL SKILLS", "LICENSES & CERTIFICATIONS", "Deep Learning Specialization"];
    const at = order.map((s) => p.sourceText.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // a date set in the right column stays on its entry's line
    expect(p.sourceText).toMatch(/Acme Labs - Data Science Intern\s+Jun 2025 - Aug 2025/);
    // bullet glyphs are normalised
    expect(p.sourceText).toContain("- Built SQL reports");
  });

  it("DOCX: heading styles become sections and list paragraphs become bullets", async () => {
    const p = await parseResumeFile({ name: "a.docx", bytes: await buildDocx() }, opts);
    expect(p.sections.map((s) => s.heading)).toEqual(["Contact", "Summary", "Education", "Work Experience", "Academic Projects", "Technical Skills", "Licenses & Certifications"]);
    const exp = p.sections.find((s) => s.key === "experience")!;
    expect(exp.sourceText.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
    expect(p.draft!.entries.find((e) => e.section === "experience")!.bullets[0]!.text).toBe("Built SQL reports that the analytics team used for weekly planning");
  });

  it("MD: # headings and - bullets", async () => {
    const p = await parseResumeFile({ name: "a.md", bytes: mdBytes() }, opts);
    expect(p.sections.map((s) => s.heading)).toContain("Work Experience");
    expect(p.sourceText).not.toContain("#");
    expect(p.sourceText).not.toContain("**");
  });
});

describe("deterministic ids", () => {
  it("re-importing the same file (at a different time) gives identical factIds, entryIds and groupIds", async () => {
    for (const [name, bytes] of await allFormats()) {
      const a = await parseResumeFile({ name, bytes }, { ...testDeps, now: new Date("2026-01-01T00:00:00Z") });
      const b = await parseResumeFile({ name, bytes }, { ...testDeps, now: new Date("2027-05-05T00:00:00Z") });
      expect(allFacts(a.draft!).map((f) => f.factId)).toEqual(allFacts(b.draft!).map((f) => f.factId));
      expect(a.draft!.entries.map((e) => e.entryId)).toEqual(b.draft!.entries.map((e) => e.entryId));
      expect(a.draft!.skillGroups.map((g) => g.groupId)).toEqual(b.draft!.skillGroups.map((g) => g.groupId));
      expect(a.draft!.masterId).toBe(b.draft!.masterId);
      const ids = allFacts(a.draft!).map((f) => f.factId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id.length).toBeLessThanOrEqual(80);
    }
  });

  it("a changed bullet changes only its own id", async () => {
    const base = (await allFormats())[0]![1];
    const edited = enc(new TextDecoder().decode(base).replace("Built SQL reports", "Built SQL dashboards"));
    const a = await parseResumeFile({ name: "a.txt", bytes: base }, opts);
    const b = await parseResumeFile({ name: "a.txt", bytes: edited }, opts);
    const ia = allFacts(a.draft!).map((f) => f.factId);
    const ib = allFacts(b.draft!).map((f) => f.factId);
    expect(ia.filter((x, i) => x !== ib[i])).toHaveLength(1);
  });
});

describe("low-confidence flags and unknown sections", () => {
  it("a section the parser cannot place goes under 'unknown' with its text, is warned about, and is never invented into the draft", async () => {
    const txt = ["Sam Sample", "sam@example.test", "EXPERIENCE", "Example Co - Analyst    2024 - 2025", "- Did analysis", "HOBBIES AND INTERESTS", "Chess and long distance running", "Gardening"].join("\n");
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    const unknown = p.sections.filter((s) => s.key === "unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.heading).toBe("HOBBIES AND INTERESTS");
    expect(unknown[0]!.sourceText).toBe("Chess and long distance running\nGardening");
    expect(unknown[0]!.confidence).toBeLessThan(0.6);
    expect(p.warnings.some((w) => w.includes("HOBBIES AND INTERESTS") && /could not be placed/.test(w))).toBe(true);
    expect(JSON.stringify(p.draft)).not.toMatch(/Gardening|Chess/);
    expect(p.sourceText).toContain("Gardening");
  });

  it("an uncertain section (duplicate heading, ambiguous order) flags its facts", async () => {
    const txt = ["Sam Sample", "sam@example.test", "EXPERIENCE", "Example Co - Analyst    2024 - 2025", "- Did analysis", "SKILLS", "Python", "EXPERIENCE", "Other Co - Tester    2023 - 2024", "- Tested things"].join("\n");
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    const exps = p.sections.filter((s) => s.key === "experience");
    expect(exps[0]!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(exps[1]!.confidence).toBeLessThan(0.6);
    expect(p.warnings.some((w) => /more than once/.test(w))).toBe(true);
    const entries = p.draft!.entries;
    expect(entries[0]!.heading.lowConfidence).toBe(false);
    expect(entries[1]!.heading.lowConfidence).toBe(true);
    expect(entries[1]!.bullets.every((b) => b.lowConfidence)).toBe(true);
  });

  it("a two-column PDF merges columns into single lines: text is kept, nothing is imported as confident facts", async () => {
    const p = await parseResumeFile({ name: "cols.pdf", bytes: await buildTwoColumnPdf() }, opts);
    expect(p.hasExtractableText).toBe(true);
    expect(p.sourceText).toMatch(/Built SQL reports for weekly planning\s+Machine learning with scikit-learn/);
    expect(p.sections.some((s) => s.key === "unknown" && s.confidence < 0.6 && /Acme Labs/.test(s.sourceText))).toBe(true);
    expect(p.warnings.some((w) => /could not be placed/.test(w))).toBe(true);
    expect(allFacts(p.draft!).every((f) => f.lowConfidence || f.provenance.source === "resume_import_approved")).toBe(true);
    expect(p.draft!.entries).toEqual([]);
  });

  it("column-merged lines inside a recognised section are flagged per fact and drop the section below the uncertainty line", async () => {
    const txt = [
      "Sam Sample",
      "sam@example.test",
      "EXPERIENCE",
      "Example Co - Analyst    2024 - 2025",
      "- Built SQL reports for weekly planning    Machine learning with scikit-learn",
      "- Wrote the monthly review pack    Python and pandas for analysis",
      "- Ran the team stand-up    Docker and Linux tooling",
    ].join("\n");
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    const exp = p.sections.find((s) => s.key === "experience")!;
    expect(exp.confidence).toBeLessThan(0.6);
    const e = p.draft!.entries[0]!;
    expect(e.heading.lowConfidence).toBe(true);
    expect(e.bullets.every((b) => b.lowConfidence)).toBe(true);
    expect(p.warnings.some((w) => /low confidence/.test(w))).toBe(true);
  });

  it("a single merged line in an otherwise clean section flags only that fact", async () => {
    const txt = ["Sam Sample", "sam@example.test", "EXPERIENCE", "Example Co - Analyst    2024 - 2025", "- Clean bullet one", "- Clean bullet two", "- Merged bullet    stray other column text", "- Clean bullet four"].join("\n");
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    expect(p.sections.find((s) => s.key === "experience")!.confidence).toBeGreaterThanOrEqual(0.6);
    const flags = p.draft!.entries[0]!.bullets.map((b) => b.lowConfidence);
    expect(flags).toEqual([false, false, true, false]);
  });

  it("a file with no headings keeps a contact block and an unknown section instead of dropping text", async () => {
    const txt = "Sam Sample\nsam@example.test\n\nI worked on some things for a while and then on other things.\nThey went fine.";
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    expect(p.sections.map((s) => s.key)).toEqual(["contact", "unknown"]);
    expect(p.sections[1]!.sourceText).toContain("worked on some things");
    expect(p.draft!.entries).toEqual([]);
  });

  it("an over-long fact is truncated to the schema limit, flagged, and its source text is kept", async () => {
    const long = "word ".repeat(200).trim();
    const txt = `Sam Sample\nsam@example.test\nSUMMARY\n${long}`;
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    expect(p.draft!.summary!.text.length).toBeLessThanOrEqual(600);
    expect(p.draft!.summary!.lowConfidence).toBe(true);
    expect(p.draft!.summary!.sourceText!.length).toBeGreaterThan(600);
  });

  it("wrapped bullet lines are joined instead of becoming new entries", async () => {
    const txt = ["Sam Sample", "sam@example.test", "EXPERIENCE", "Example Co - Analyst    2024 - 2025", "- Wrote a long report that covered the whole", "year of operations in detail", "- Second bullet"].join("\n");
    const p = await parseResumeFile({ name: "s.txt", bytes: enc(txt) }, opts);
    expect(p.draft!.entries).toHaveLength(1);
    expect(p.draft!.entries[0]!.bullets.map((b) => b.text)).toEqual(["Wrote a long report that covered the whole year of operations in detail", "Second bullet"]);
  });
});

describe("scanned and empty files", () => {
  it("a scanned PDF has no extractable text: exact warning, no draft, no garbage", async () => {
    const p = await parseResumeFile({ name: "scan.pdf", bytes: await buildScannedPdf() }, opts);
    expect(p.hasExtractableText).toBe(false);
    expect(p.draft).toBeNull();
    expect(p.sections).toEqual([]);
    expect(p.sourceText).toBe("");
    expect(p.warnings).toEqual(["No extractable text in this PDF. OCR is not supported yet."]);
    expect(NO_TEXT_PDF_WARNING).toBe("No extractable text in this PDF. OCR is not supported yet.");
  });

  it("empty DOCX and empty TXT likewise", async () => {
    const d = await parseResumeFile({ name: "e.docx", bytes: await buildEmptyDocx() }, opts);
    expect(d.hasExtractableText).toBe(false);
    expect(d.draft).toBeNull();
    expect(d.warnings).toHaveLength(1);
    const t = await parseResumeFile({ name: "e.txt", bytes: enc("  \n\n \t\n") }, opts);
    expect(t.hasExtractableText).toBe(false);
    expect(t.draft).toBeNull();
  });

  it("a corrupt PDF reports a read error instead of throwing", async () => {
    const p = await parseResumeFile({ name: "bad.pdf", bytes: enc("%PDF-1.4 this is not a pdf") }, opts);
    expect(p.hasExtractableText).toBe(false);
    expect(p.draft).toBeNull();
    expect(p.warnings[0]).toMatch(/Could not read this PDF/);
  });

  it("an unsupported extension is rejected with a warning", async () => {
    const p = await parseResumeFile({ name: "photo.png", bytes: new Uint8Array([137, 80, 78, 71]) }, opts);
    expect(p.draft).toBeNull();
    expect(p.warnings[0]).toMatch(/Unsupported file type/);
  });
});

describe("size cap", () => {
  it("rejects a file over options.maxBytes without parsing it", async () => {
    let called = false;
    const p = await parseResume({ name: "big.pdf", bytes: new Uint8Array(2000) }, { maxBytes: 1000 });
    expect(p.hasExtractableText).toBe(false);
    expect(p.draft).toBeNull();
    expect(p.sourceText).toBe("");
    expect(p.warnings[0]).toMatch(/over the .* import limit\. Nothing was read\./);
    const q = await parseResumeFile(
      { name: "big.pdf", bytes: new Uint8Array(2000) },
      {
        maxBytes: 1000,
        loadPdfjs: async () => {
          called = true;
          throw new Error("should not load");
        },
      },
    );
    expect(q.draft).toBeNull();
    expect(called).toBe(false);
  });

  it("defaults to a 10 MB cap", async () => {
    expect(DEFAULT_IMPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
    const p = await parseResume({ name: "big.txt", bytes: new Uint8Array(DEFAULT_IMPORT_MAX_BYTES + 1) });
    expect(p.draft).toBeNull();
    expect(p.warnings[0]).toMatch(/10 MB import limit/);
    const ok = await parseResume({ name: "ok.txt", bytes: txtBytes() });
    expect(ok.draft).not.toBeNull();
  });
});

describe("confirmImport", () => {
  it("is pure, stamps confirmedAt, and marks every fact resume_import_approved with the confirmation time", async () => {
    const p = await parseResumeFile({ name: "a.txt", bytes: txtBytes() }, opts);
    const draft = p.draft!;
    const before = JSON.stringify(draft);
    const now = new Date("2026-03-04T05:06:07.000Z");
    const master = confirmImport(draft, now);
    expect(JSON.stringify(draft)).toBe(before); // input untouched
    expect(MasterResumeSchema.safeParse(master).success).toBe(true);
    expect(master.confirmedAt).toBe(now.toISOString());
    const facts = allFacts(master);
    expect(facts.length).toBe(allFacts(draft).length);
    for (const f of facts) expect(f.provenance).toEqual({ source: "resume_import_approved", recordedAt: now.toISOString(), note: "approved resume import" });
    expect(facts.map((f) => f.factId)).toEqual(allFacts(draft).map((f) => f.factId));
    expect(facts.map((f) => f.text)).toEqual(allFacts(draft).map((f) => f.text));
    expect(master.importedFrom?.filename).toBe("a.txt");
    expect(confirmImport(draft, now)).toEqual(master);
  });

  it("keeps edits the user made to the draft (text and id)", async () => {
    const p = await parseResumeFile({ name: "a.txt", bytes: txtBytes() }, opts);
    const draft = structuredClone(p.draft!);
    const bullet = draft.entries[1]!.bullets[0]!;
    const id = bullet.factId;
    bullet.text = "Edited wording";
    const master = confirmImport(draft, new Date());
    expect(master.entries[1]!.bullets[0]).toMatchObject({ factId: id, text: "Edited wording" });
  });
});

describe("fixtures", () => {
  it("round-trips real files written to disk", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ap-resume-fixtures-"));
    const files: [string, Uint8Array][] = [...(await allFormats()), ["scan.pdf", await buildScannedPdf()]];
    for (const [name, bytes] of files) {
      writeFileSync(path.join(dir, name), bytes);
      const back = new Uint8Array(readFileSync(path.join(dir, name)));
      const p = await parseResumeFile({ name, bytes: back }, opts);
      expect(p.hasExtractableText).toBe(name !== "scan.pdf");
    }
    // The DOCX and PDF are real container formats.
    expect(Array.from((await buildDocx()).slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(new TextDecoder().decode((await buildTextPdf()).slice(0, 5))).toBe("%PDF-");
  });

  it("sampleMaster() and longMaster() are valid and stable", () => {
    const s = sampleMaster();
    expect(MasterResumeSchema.safeParse(s).success).toBe(true);
    expect(s.entries.filter((e) => e.section === "experience")).toHaveLength(2);
    expect(s.entries.filter((e) => e.section === "projects")).toHaveLength(3);
    expect(s.entries.some((e) => e.section === "certifications")).toBe(true);
    expect(s.skillGroups.length).toBeGreaterThanOrEqual(2);
    expect(sampleMaster()).toEqual(s);
    const l = longMaster();
    expect(MasterResumeSchema.safeParse(l).success).toBe(true);
    const bullets = l.entries.reduce((n, e) => n + e.bullets.length, 0);
    expect(bullets).toBeGreaterThanOrEqual(70);
    expect(longMaster()).toEqual(l);
    const ids = new Set<string>();
    for (const f of allFacts(l)) {
      expect(ids.has(f.factId)).toBe(false);
      ids.add(f.factId);
    }
  });
});
