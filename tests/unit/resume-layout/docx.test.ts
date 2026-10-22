// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { exportDocx, docxNotice } from "@/resume/export";
import { DEFAULT_LAYOUT, LayoutConfigSchema } from "@/resume/schema";
import { smallResume } from "./fixtures";

// jszip is a dependency of docx (not a direct dependency of this project): resolve it through docx.
const req = createRequire(createRequire(import.meta.url).resolve("docx"));
const JSZip = req("jszip") as { loadAsync(data: Uint8Array): Promise<{ file(name: string): { async(t: "string"): Promise<string> } | null }> };

const cfg = (o = {}) => LayoutConfigSchema.parse({ ...DEFAULT_LAYOUT, ...o });

async function parts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return { doc: (await zip.file("word/document.xml")!.async("string")), rels: (await zip.file("word/_rels/document.xml.rels")!.async("string")) };
}

describe("exportDocx", () => {
  it("contains section titles, bullets, header and links, in the configured section order", async () => {
    const r = smallResume();
    const bytes = await exportDocx(r, cfg());
    expect(bytes[0]).toBe(0x50); // zip magic "PK"
    const { doc, rels } = await parts(bytes);
    for (const t of ["Summary", "Education", "Experience", "Projects", "Skills", "Alex Example", "alex@example.test"]) expect(doc).toContain(t);
    for (const s of r.sections) for (const e of s.entries) for (const l of e.lines) if (l.role === "bullet") expect(doc).toContain(l.text);
    expect(doc.indexOf("Education")).toBeLessThan(doc.indexOf("Experience"));
    expect(doc.indexOf("Experience")).toBeLessThan(doc.indexOf("Projects"));
    expect(doc).toContain("<w:numPr>"); // real list bullets
    expect(doc).toContain("w:hyperlink");
    expect(rels).toContain("https://github.com/alex-example");
    expect(rels).toContain("mailto:alex@example.test");
  });

  it("follows config.sectionOrder and page size", async () => {
    const bytes = await exportDocx(smallResume(), cfg({ sectionOrder: ["skills", "education", "experience", "projects", "summary"], pageSize: "a4" }));
    const { doc } = await parts(bytes);
    expect(doc.indexOf("Skills")).toBeLessThan(doc.indexOf("Education"));
    expect(doc.indexOf("Education")).toBeLessThan(doc.indexOf("Summary"));
    expect(doc).toContain('w:w="11906"');
  });

  it("labels the DOCX as not page-validated", () => {
    expect(docxNotice()).toBe("page count not validated for DOCX");
  });
});
