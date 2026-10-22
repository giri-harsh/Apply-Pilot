// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { layoutPdf, validatePdf } from "@/resume/layout";
import { loadDefaultFonts } from "@/resume/layout/fonts";
import { createContext } from "@/resume/layout/render";
import { measureLayout } from "@/resume/layout/measure";
import { tighteningLadder } from "@/resume/layout/fit";
import { DEFAULT_LAYOUT, LAYOUT_FLOORS, LayoutConfigSchema, LayoutResultSchema, type LayoutConfig, type TailoredResume } from "@/resume/schema";
import type { ShortenFn } from "@/resume/contracts";
import { header, line, longResume, resume, smallResume } from "./fixtures";
import { linkUris, positionedText } from "./helpers";

const cfg = (o: Partial<LayoutConfig> = {}) => LayoutConfigSchema.parse({ ...DEFAULT_LAYOUT, ...o });
const noopShorten: ShortenFn = async () => [];

async function measurer() {
  return (await createContext(await loadDefaultFonts())).measurer;
}

describe("layout engine: basics", () => {
  it("lays the small resume out on one page without any fit action, and the engine page count equals the reloaded bytes", async () => {
    const { bytes, result } = await layoutPdf(smallResume(), cfg());
    expect(result.pageCount).toBe(1);
    expect(result.satisfiedLimit).toBe(true);
    expect(result.droppedLineIds).toEqual([]);
    expect(result.shortenedLineIds).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(LayoutResultSchema.safeParse(result).success).toBe(true);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(result.pageCount);
  });

  it("writes a sample PDF for visual review", async () => {
    const { bytes } = await layoutPdf(smallResume(), cfg());
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/resume-sample.pdf", bytes);
    const long = await layoutPdf(longResume(false), cfg());
    writeFileSync("test-results/resume-sample-fitted.pdf", long.bytes);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("supports A4 and a multi-page limit", async () => {
    const { bytes, result } = await layoutPdf(longResume(true), cfg({ pageSize: "a4", pageLimit: 3 }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.satisfiedLimit).toBe(true);
    expect(result.droppedLineIds).toEqual([]);
    expect(doc.getPageCount()).toBe(result.pageCount);
  });

  it("honours section order from the config", async () => {
    const { bytes } = await layoutPdf(smallResume(), cfg({ sectionOrder: ["skills", "education", "experience", "projects", "summary"] }));
    const { items } = await positionedText(bytes);
    const text = items.map((i) => i.str).join(" ");
    expect(text.indexOf("Skills")).toBeLessThan(text.indexOf("Education"));
    expect(text.indexOf("Education")).toBeLessThan(text.indexOf("Summary"));
  });
});

describe("layout engine: geometry", () => {
  it("no placed segment exceeds the content width (engine measurement), including long unbreakable tokens", async () => {
    const m = await measurer();
    const url = "https://example.test/" + "very-long-path-segment/".repeat(12) + "end";
    const r = resume([
      header(),
      { key: "projects", title: "Projects", entries: [{ entryId: "p", lines: [line("pt", "section_title", "Projects", { protected: true }), line("ph", "entry_heading", "Link heavy project", {}), line("pb", "bullet", `See ${url} for the writeup and ${"x".repeat(200)} for the id.`, {})] }] },
    ]);
    const layout = measureLayout(r, cfg({ pageLimit: 3 }), m);
    expect(layout.pages.flat().length).toBeGreaterThan(5);
    for (const pl of layout.pages.flat()) {
      for (const s of pl.segs) expect(pl.x + s.x + s.w).toBeLessThanOrEqual(layout.contentWidth + 0.05);
      expect(pl.right ? pl.right.x + pl.right.w : 0).toBeLessThanOrEqual(layout.contentWidth + 0.05);
    }
  });

  it("no rendered text extends past the right margin in the actual PDF (pdfjs positions)", async () => {
    for (const [name, r, c] of [
      ["small", smallResume(), cfg()],
      ["long", longResume(true), cfg({ pageLimit: 3 })],
      ["a4", longResume(false), cfg({ pageSize: "a4", marginIn: 0.5 })],
    ] as const) {
      const { bytes, result } = await layoutPdf(r, c);
      const { items, pageWidths } = await positionedText(bytes);
      const margin = result.appliedConfig.marginIn * 72;
      expect(items.length, name).toBeGreaterThan(10);
      for (const it of items) {
        expect(it.x, `${name}: ${it.str}`).toBeGreaterThanOrEqual(margin - 0.6);
        expect(it.x + it.width, `${name}: ${it.str}`).toBeLessThanOrEqual(pageWidths[it.page - 1]! - margin + 0.6);
      }
    }
  });

  it("never leaves a section title as the last item on a page", async () => {
    const m = await measurer();
    // Sweep top margins by varying fixture size so many page-break positions are exercised.
    for (let bullets = 1; bullets <= 18; bullets++) {
      const lines = Array.from({ length: bullets }, (_, i) => line(`b${i}`, "bullet", `Filler bullet number ${i} that is long enough to wrap onto a second line when the content width is limited ok`, {}));
      const r = resume([
        header(),
        { key: "experience", title: "Experience", entries: [{ entryId: "e", lines: [line("t1", "section_title", "Experience", { protected: true }), line("h1", "entry_heading", "Filler", {}), ...lines] }] },
        { key: "projects", title: "Projects", entries: [{ entryId: "p", lines: [line("t2", "section_title", "Projects", { protected: true }), line("h2", "entry_heading", "Another", {}), ...lines.map((l) => ({ ...l, lineId: "p" + l.lineId }))] }] },
      ]);
      const layout = measureLayout(r, cfg({ pageLimit: 5 }), m);
      layout.pages.forEach((_, pageIdx) => {
        const onPage = layout.blockInfo.filter((b) => b.page === pageIdx + 1);
        if (onPage.length) expect(onPage[onPage.length - 1]!.kind).not.toBe("title");
      });
      // Titles must be followed by content on the same page.
      layout.blockInfo.forEach((b, i) => {
        if (b.kind === "title") expect(layout.blockInfo[i + 1]?.page).toBe(b.page);
      });
    }
  });
});

describe("layout engine: unicode", () => {
  it("renders rupee, smart quotes, dashes, bullets, accents and Greek/Cyrillic names with the embedded font (no warnings)", async () => {
    const r = resume([
      header("José Núñez"),
      {
        key: "experience",
        title: "Experience",
        entries: [
          {
            entryId: "e",
            lines: [
              line("t", "section_title", "Experience", { protected: true }),
              line("h", "entry_heading", "Αλέξανδρος / Александр — Analyst"),
              line("b1", "bullet", "Saved ₹2.4 crore (₹24,000,000) – “smart” quotes, it’s — an em dash • éèê łódź ř ß"),
            ],
          },
        ],
      },
    ]);
    const { bytes, result } = await layoutPdf(r, cfg());
    expect(result.warnings).toEqual([]);
    const { items } = await positionedText(bytes);
    const text = items.map((i) => i.str).join(" ");
    for (const s of ["José Núñez", "₹2.4", "“smart”", "it’s", "–", "—", "Łódź".toLowerCase().slice(1), "Αλέξανδρος", "Александр"]) {
      expect(text, s).toContain(s);
    }
  });

  it("reports characters the font lacks (Devanagari, CJK, emoji) as warnings and draws a visible '?' instead of a glyph box", async () => {
    const r = resume([
      header("अलेक्स 李雷"),
      { key: "summary", title: "Summary", entries: [{ entryId: "s", lines: [line("t", "section_title", "Summary", { protected: true }), line("p", "paragraph", "Launch 🚀 done")] }] },
    ]);
    const { bytes, result } = await layoutPdf(r, cfg());
    expect(result.warnings.some((w) => w.includes("U+0905"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("U+674E"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("U+1F680"))).toBe(true);
    const { items } = await positionedText(bytes);
    const text = items.map((i) => i.str).join(" ");
    expect(text).toContain("Launch ? done");
    expect(text).not.toContain("李");
  });
});

describe("layout engine: links", () => {
  it("creates real link annotations for urls and bare emails", async () => {
    const { bytes } = await layoutPdf(smallResume(), cfg());
    const uris = (await linkUris(bytes)).flat();
    expect(uris).toContain("https://github.com/alex-example");
    expect(uris).toContain("https://linkedin.com/in/alex-example");
    expect(uris).toContain("mailto:alex@example.test");
    expect(uris).toContain("https://github.com/alex-example/sales-forecaster");
  });

  it("does not create annotations for non-http(s)/mailto/tel schemes", async () => {
    const r = resume([header("Alex Example", [line("bad", "contact", "click me", { url: "javascript:alert(1)" })])]);
    const { bytes } = await layoutPdf(r, cfg());
    expect((await linkUris(bytes)).flat().some((u) => u.startsWith("javascript"))).toBe(false);
  });
});

describe("layout engine: determinism", () => {
  it("produces identical bytes for identical input", async () => {
    const a = await layoutPdf(longResume(false), cfg());
    const b = await layoutPdf(longResume(false), cfg());
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(a.result).toEqual(b.result);
  });
});

describe("fit loop", () => {
  function protectedIds(r: TailoredResume) {
    return r.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).filter((l) => l.protected || l.onlyEvidenceForRequiredQualification || l.role === "section_title" || l.role === "name" || l.role === "contact").map((l) => l.lineId);
  }
  const allIds = (r: TailoredResume) => r.sections.flatMap((s) => s.entries.flatMap((e) => e.lines.map((l) => l.lineId)));

  it("fits an over-long but droppable resume by spacing and dropping, reporting each action, never below the floors", async () => {
    const src = longResume(false);
    const { bytes, result } = await layoutPdf(src, cfg(), { shorten: noopShorten });
    expect(result.pageCount).toBe(1);
    expect(result.satisfiedLimit).toBe(true);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(result.warnings.some((w) => w.startsWith("Tightened spacing"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("Dropped"))).toBe(true);
    expect(result.droppedLineIds.length).toBeGreaterThan(0);
    // finalResume reflects exactly the reported drops
    const finalIds = new Set(allIds(result.finalResume));
    for (const id of result.droppedLineIds) expect(finalIds.has(id)).toBe(false);
    expect(allIds(result.finalResume).length + result.droppedLineIds.length).toBe(allIds(src).length);
    for (const id of protectedIds(src)) expect(finalIds.has(id), id).toBe(true);
    const c = result.appliedConfig;
    expect(c.bodyPt).toBeGreaterThanOrEqual(LAYOUT_FLOORS.bodyPt);
    expect(c.marginIn).toBeGreaterThanOrEqual(LAYOUT_FLOORS.marginIn);
    expect(c.lineHeight).toBeGreaterThanOrEqual(LAYOUT_FLOORS.lineHeight);
    expect(LayoutConfigSchema.safeParse(c).success).toBe(true);
    expect(LayoutResultSchema.safeParse(result).success).toBe(true);
  });

  it("drops lowest relevance first and bullets before whole entries", async () => {
    const src = longResume(false);
    const rel = new Map(src.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).map((l) => [l.lineId, l.relevance]));
    const { result } = await layoutPdf(src, cfg());
    const dropped = result.droppedLineIds;
    const bulletDrops = dropped.filter((id) => id.includes("_b") || id === "edu_b1");
    expect(bulletDrops.length).toBeGreaterThan(0);
    // The first dropped line is a minimum-relevance bullet.
    const minBullet = Math.min(...[...rel.entries()].filter(([id]) => id.includes("_b")).map(([, v]) => v));
    expect(rel.get(dropped[0]!)).toBeCloseTo(minBullet, 5);
    // Phase A (single bullets) always precedes phase B (whole entries): once a heading is dropped, no later drop is a lone bullet
    // of an entry that still has its heading.
    const firstHeading = dropped.findIndex((id) => id.endsWith("_h"));
    if (firstHeading !== -1) {
      const finalHeadings = new Set(result.finalResume.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).filter((l) => l.role === "entry_heading").map((l) => l.lineId));
      for (const id of dropped.slice(firstHeading)) {
        if (id.includes("_b") && id !== "edu_b1") expect(finalHeadings.has(id.replace(/_b\d+$/, "_h"))).toBe(false);
      }
    }
  });

  it("reports an honest failure when protected content cannot fit: satisfiedLimit=false, best 2-page result, warning with reason, nothing protected dropped", async () => {
    const src = longResume(true);
    const { bytes, result } = await layoutPdf(src, cfg(), { shorten: noopShorten });
    expect(result.satisfiedLimit).toBe(false);
    expect(result.pageCount).toBe(2);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const w = result.warnings.find((x) => x.includes("one-page constraint not met cleanly"));
    expect(w).toBeTruthy();
    expect(w).toMatch(/protected|required/);
    // the only droppable thing is the unprotected education bullet; every protected / required line is present
    const finalIds = new Set(allIds(result.finalResume));
    for (const id of protectedIds(src)) expect(finalIds.has(id), id).toBe(true);
    for (const id of result.droppedLineIds) expect(protectedIds(src)).not.toContain(id);
    // best result = tightest allowed layout
    expect(result.appliedConfig.bodyPt).toBe(LAYOUT_FLOORS.bodyPt);
    expect(result.appliedConfig.marginIn).toBe(LAYOUT_FLOORS.marginIn);
    expect(result.appliedConfig.lineHeight).toBe(LAYOUT_FLOORS.lineHeight);
    const v = await validatePdf(bytes, { pageLimit: 1, requiredSections: ["Education"], contact: { name: "Priya Natarajan" } });
    expect(v.ok).toBe(false);
    expect(v.pageCount).toBe(2);
  });

  it("never drops onlyEvidenceForRequiredQualification lines, the most relevant education entry, or the last entry of a section", async () => {
    const src = longResume(false);
    const exp0 = src.sections.find((s) => s.key === "experience")!.entries[2]!;
    exp0.lines.forEach((l) => {
      if (l.role === "bullet") l.onlyEvidenceForRequiredQualification = true;
    });
    const { result } = await layoutPdf(src, cfg());
    const finalIds = new Set(allIds(result.finalResume));
    for (const l of exp0.lines) if (l.onlyEvidenceForRequiredQualification) expect(finalIds.has(l.lineId)).toBe(true);
    expect(finalIds.has("edu_h")).toBe(true);
    expect(finalIds.has("edu_m")).toBe(true);
    for (const key of ["education", "experience", "projects", "skills"]) {
      const s = result.finalResume.sections.find((x) => x.key === key)!;
      expect(s.entries.length, key).toBeGreaterThan(0);
    }
  });

  it("uses shorten first: accepts only strictly shorter replacements for requested lineIds, ignores longer ones, and reports them", async () => {
    // A resume that overflows by a couple of lines: shortening alone should rescue it.
    // Extra bullets are protected so dropping cannot rescue the page: only shortening can. Find the smallest count that overflows.
    const make = (count: number) => {
      const r = smallResume();
      r.sections.forEach((s) => s.entries.forEach((e) => e.lines.forEach((l) => (l.protected = true))));
      const extra = Array.from({ length: count }, (_, i) =>
        line(`x${i}`, "bullet", `Extra accomplishment number ${i}: delivered a cross-functional analytics improvement that measurably reduced manual effort for the whole team across several quarters of work.`, { relevance: 0.1 + i * 0.01, protected: true }),
      );
      r.sections.find((s) => s.key === "experience")!.entries[0]!.lines.push(...extra);
      return r;
    };
    const tight = cfg({ sectionGapPt: 2, entryGapPt: 1, lineHeight: 1.1, marginIn: 0.5, bodyPt: 10 });
    let base = make(1);
    const m = await measurer();
    for (let n = 1; n <= 80; n++) {
      base = make(n);
      if (measureLayout(base, tighteningLadder(tight).at(-1)!, m).pageCount > 1) break;
    }
    const requested: string[] = [];
    const shorten: ShortenFn = async (lines) => {
      requested.push(...lines.map((l) => l.lineId));
      return lines.map((l, i) => (i === 0 ? { ...l, text: l.text + " and even more words" } : { ...l, text: l.text.split(" ").slice(0, 6).join(" ") + "." }));
    };
    const noShorten = await layoutPdf(base, tight);
    expect(noShorten.result.satisfiedLimit).toBe(false);
    const { result } = await layoutPdf(base, tight, { shorten });
    expect(result.satisfiedLimit).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.length).toBeLessThanOrEqual(12);
    expect(result.shortenedLineIds.length).toBeGreaterThan(0);
    expect(result.shortenedLineIds).not.toContain(requested[0]);
    expect(result.warnings.some((w) => w.startsWith("Ignored 1 shortened"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("Shortened"))).toBe(true);
    const finalLines = new Map(result.finalResume.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).map((l) => [l.lineId, l]));
    for (const id of result.shortenedLineIds) {
      const l = finalLines.get(id)!;
      expect(l.origin).toBe("rewritten");
      expect(l.masterText).toBeTruthy();
      expect(l.text.length).toBeLessThan(l.masterText!.length);
    }
    expect(finalLines.get(requested[0]!)!.text.endsWith("even more words")).toBe(false);
  });

  it("ignores a shorten callback that returns only longer text or unknown ids, and survives a throwing callback", async () => {
    const src = longResume(false);
    const longer: ShortenFn = async (lines) => [...lines.map((l) => ({ ...l, text: l.text + " plus more" })), { ...lines[0]!, lineId: "not-requested", text: "x" }];
    const a = await layoutPdf(src, cfg(), { shorten: longer });
    expect(a.result.shortenedLineIds).toEqual([]);
    expect(a.result.warnings.some((w) => w.startsWith("Ignored"))).toBe(true);
    const boom: ShortenFn = async () => {
      throw new Error("provider down");
    };
    const b = await layoutPdf(src, cfg(), { shorten: boom });
    expect(b.result.warnings.some((w) => w.includes("Shortening was unavailable"))).toBe(true);
    expect(b.result.pageCount).toBe(1);
  });

  it("rejects a config below the readability floors", async () => {
    await expect(layoutPdf(smallResume(), { ...DEFAULT_LAYOUT, bodyPt: 9 })).rejects.toThrow();
    await expect(layoutPdf(smallResume(), { ...DEFAULT_LAYOUT, marginIn: 0.3 })).rejects.toThrow();
  });
});
