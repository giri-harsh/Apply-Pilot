// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { layoutPdf, validatePdf } from "@/resume/layout";
import { DEFAULT_LAYOUT, LayoutConfigSchema, PdfValidationSchema } from "@/resume/schema";
import { smallResume, longResume } from "./fixtures";

const cfg = (o = {}) => LayoutConfigSchema.parse({ ...DEFAULT_LAYOUT, ...o });
const contact = { name: "Alex Example", email: "alex@example.test", phone: "+91 98765 43210" };

describe("validatePdf", () => {
  it("passes a good one-page PDF and reads the real page count from the bytes", async () => {
    const { bytes } = await layoutPdf(smallResume(), cfg());
    const v = await validatePdf(bytes, { pageLimit: 1, requiredSections: ["Education", "Experience", "Projects", "Skills"], contact });
    expect(PdfValidationSchema.safeParse(v).success).toBe(true);
    expect(v.ok).toBe(true);
    expect(v.pageCount).toBe(1);
    expect(v.missingSections).toEqual([]);
    expect(v.missingContact).toEqual([]);
  });

  it("reports missing sections and contact details", async () => {
    const { bytes } = await layoutPdf(smallResume(), cfg());
    const v = await validatePdf(bytes, { pageLimit: 1, requiredSections: ["Education", "Publications"], contact: { name: "Someone Else", email: "other@example.test", phone: "+1 555 0100" } });
    expect(v.ok).toBe(false);
    expect(v.missingSections).toEqual(["Publications"]);
    expect(v.missingContact).toEqual(["name", "email", "phone"]);
    expect(v.findings.length).toBeGreaterThan(0);
  });

  it("fails when the page count exceeds the limit", async () => {
    const { bytes, result } = await layoutPdf(longResume(true), cfg({ pageLimit: 3 }));
    expect(result.pageCount).toBe(2);
    const v = await validatePdf(bytes, { pageLimit: 1, requiredSections: ["Experience"], contact: { name: "Priya Natarajan" } });
    expect(v.ok).toBe(false);
    expect(v.pageCount).toBe(2);
    expect(v.findings.some((f) => f.includes("exceeds the limit"))).toBe(true);
    const ok2 = await validatePdf(bytes, { pageLimit: 2, requiredSections: ["Experience", "Projects"], contact: { name: "Priya Natarajan", email: "alex@example.test" } });
    expect(ok2.ok).toBe(true);
  });

  it("fails a PDF that has no extractable text (blank page)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const v = await validatePdf(await doc.save(), { pageLimit: 1, requiredSections: ["Education"], contact: { name: "Alex Example" } });
    expect(v.ok).toBe(false);
    expect(v.pageCount).toBe(1);
    expect(v.findings.some((f) => f.includes("No extractable text"))).toBe(true);
  });

  it("fails cleanly on bytes that are not a PDF", async () => {
    const v = await validatePdf(new Uint8Array([1, 2, 3, 4]), { pageLimit: 1, requiredSections: ["Education"], contact: { name: "Alex" } });
    expect(v.ok).toBe(false);
    expect(v.pageCount).toBe(0);
  });
});
