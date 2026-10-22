import { describe, expect, it } from "vitest";
import { acceptsFile, acceptsFormat } from "@/content/upload/accept";
import { chooseFileForField } from "@/content/upload/choose";
import type { FileRef } from "@/resume/schema";

const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" } as const;
function ref(format: "pdf" | "docx" | "txt", id: string, over: Partial<FileRef> = {}): FileRef {
  return { fileId: id, filename: `Alex_Resume_Acme.${format}`, mime: MIME[format], size: 1000, format, pageValidated: format === "pdf", createdAt: "2026-01-01T00:00:00.000Z", ...over };
}
const pdf = ref("pdf", "pdf1");
const docx = ref("docx", "docx1");
const both = { resume: [docx, pdf], coverLetter: [] as FileRef[] };
const fld = (accept: string, over: Partial<{ classification: "resume" | "cover_letter" | "other" | "ambiguous"; hasFile: boolean }> = {}) => ({ classification: "resume" as const, accept, hasFile: false, ...over });

describe("chooseFileForField", () => {
  const cases: [string, string, "pdf1" | "docx1" | null][] = [
    ["empty accept -> PDF", "", "pdf1"],
    ["whitespace accept -> PDF", "   ", "pdf1"],
    [".pdf", ".pdf", "pdf1"],
    [".PDF upper case", ".PDF", "pdf1"],
    ["application/pdf", "application/pdf", "pdf1"],
    ["Application/PDF mixed case", "Application/PDF", "pdf1"],
    ["application/pdf,.doc -> PDF", "application/pdf,.doc", "pdf1"],
    [".doc,.docx,.pdf -> PDF preferred", ".doc,.docx,.pdf", "pdf1"],
    [".pdf, .docx with spaces", " .pdf , .docx ", "pdf1"],
    [".docx only", ".docx", "docx1"],
    ["docx mime only", MIME.docx, "docx1"],
    [".doc,.docx", ".doc,.docx", "docx1"],
    [".doc only (legacy) -> neither", ".doc", null],
    ["image/* -> neither", "image/*", null],
    [".png,.jpg -> neither", ".png,.jpg", null],
    ["*/* -> PDF", "*/*", "pdf1"],
    ["* -> PDF", "*", "pdf1"],
    ["application/* -> PDF", "application/*", "pdf1"],
    ["text/* -> neither (no txt available)", "text/*", null],
    ["bare word is ignored by browsers", "pdf", null],
    ["trailing commas", ".pdf,,", "pdf1"],
  ];
  it.each(cases)("%s", (_n, accept, expected) => {
    const r = chooseFileForField(fld(accept), both);
    expect(r.file?.fileId ?? null).toBe(expected);
    if (expected === null) expect(r.reason).toMatch(/accepts/);
  });

  it("warns that a DOCX is not page-validated, and not for a validated PDF", () => {
    expect(chooseFileForField(fld(".docx"), both).warning).toMatch(/not page-validated/);
    expect(chooseFileForField(fld(".pdf"), both).warning).toBeNull();
  });
  it("warns for a PDF whose pages were not read back", () => {
    const r = chooseFileForField(fld(".pdf"), { resume: [ref("pdf", "p2", { pageValidated: false })], coverLetter: [] });
    expect(r.warning).toMatch(/not page-validated/);
  });
  it("never replaces a field that already holds a file", () => {
    const r = chooseFileForField(fld("", { hasFile: true }), both);
    expect(r.file).toBeNull();
    expect(r.reason).toMatch(/already holds/);
  });
  it("never puts a resume into other / ambiguous / cover-letter fields", () => {
    const avail = { resume: [pdf], coverLetter: [] as FileRef[] };
    for (const classification of ["other", "ambiguous"] as const) expect(chooseFileForField(fld("", { classification }), avail).file).toBeNull();
    const cl = chooseFileForField(fld("", { classification: "cover_letter" }), avail);
    expect(cl.file).toBeNull();
    expect(cl.reason).toMatch(/No cover letter/);
  });
  it("picks cover letters only from the cover-letter pool", () => {
    const cover = ref("pdf", "cl1", { filename: "Alex_CoverLetter_Acme.pdf" });
    const r = chooseFileForField(fld("", { classification: "cover_letter" }), { resume: [pdf], coverLetter: [cover] });
    expect(r.file?.fileId).toBe("cl1");
  });
  it("reports when there is nothing to upload", () => {
    expect(chooseFileForField(fld(""), { resume: [], coverLetter: [] })).toMatchObject({ file: null });
  });
  it("prefers the newest file of the preferred format", () => {
    const newer = ref("pdf", "pdf2", { createdAt: "2026-06-01T00:00:00.000Z" });
    expect(chooseFileForField(fld(""), { resume: [pdf, newer], coverLetter: [] }).file?.fileId).toBe("pdf2");
  });
  it("uses a DOCX when no PDF exists even with empty accept", () => {
    expect(chooseFileForField(fld(""), { resume: [docx], coverLetter: [] }).file?.fileId).toBe("docx1");
  });
});

describe("accept helpers", () => {
  it("acceptsFormat", () => {
    expect(acceptsFormat("", "pdf")).toBe(true);
    expect(acceptsFormat(".docx", "pdf")).toBe(false);
  });
  it("acceptsFile checks a concrete file", () => {
    expect(acceptsFile(".pdf", "a_Resume_b.PDF", "application/pdf")).toBe(true);
    expect(acceptsFile("image/*", "a_Resume_b.pdf", "application/pdf")).toBe(false);
    expect(acceptsFile("", "noext", "")).toBe(true);
    expect(acceptsFile(".pdf", "noext", "")).toBe(false);
  });
});
