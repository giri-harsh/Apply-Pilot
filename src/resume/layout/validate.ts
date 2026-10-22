import { PDFDocument } from "pdf-lib";
import type { PdfValidation } from "../schema";
import type { ValidatePdfFn } from "../contracts";
import { normalizeForMatch } from "./model";

export interface ValidateDeps {
  /** Worker URL for pdfjs when running in an extension page. Omitted in tests / node (pdfjs then runs its fake worker). */
  workerSrc?: string;
}

export interface ExtractedText {
  pages: string[];
  numPages: number;
}

/** Extracts text per page with pdfjs-dist (legacy build, loaded lazily so it never enters the service-worker bundle). */
export async function extractPdfText(bytes: Uint8Array, deps: ValidateDeps = {}): Promise<ExtractedText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (deps.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = deps.workerSrc;
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return { pages, numPages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

const digits = (s: string) => s.replace(/\D+/g, "");

export const validatePdf: ValidatePdfFn = (bytes, expectations) => validatePdfWith(bytes, expectations, {});

/** Reloads the PDF to read the real page count, extracts its text, and checks required sections and contact details. */
export async function validatePdfWith(
  bytes: Uint8Array,
  expectations: Parameters<ValidatePdfFn>[1],
  deps: ValidateDeps,
): Promise<PdfValidation> {
  const findings: string[] = [];
  const missingSections: string[] = [];
  const missingContact: string[] = [];
  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch (e) {
    return { ok: false, pageCount: 0, pageLimit: expectations.pageLimit, missingSections: [...expectations.requiredSections], missingContact: ["name"], findings: [`PDF could not be reloaded: ${(e instanceof Error ? e.message : "error").slice(0, 200)}`] };
  }

  let text = "";
  try {
    const ex = await extractPdfText(bytes, deps);
    text = ex.pages.join("\n");
    if (ex.numPages !== pageCount) findings.push(`Page count mismatch: pdf-lib read ${pageCount}, pdfjs read ${ex.numPages}.`);
  } catch (e) {
    findings.push(`Text extraction failed: ${(e instanceof Error ? e.message : "error").slice(0, 200)}`);
  }

  if (!text.trim()) findings.push("No extractable text found in the PDF.");
  const compact = normalizeForMatch(text);
  for (const s of expectations.requiredSections) if (!compact.includes(normalizeForMatch(s))) missingSections.push(s);
  const c = expectations.contact;
  if (!compact.includes(normalizeForMatch(c.name))) missingContact.push("name");
  if (c.email && !compact.includes(normalizeForMatch(c.email))) missingContact.push("email");
  if (c.phone && !digits(text).includes(digits(c.phone))) missingContact.push("phone");

  if (pageCount > expectations.pageLimit) findings.push(`Page count ${pageCount} exceeds the limit of ${expectations.pageLimit}.`);
  if (missingSections.length) findings.push(`Missing section(s) in the rendered text: ${missingSections.join(", ")}.`);
  if (missingContact.length) findings.push(`Missing contact detail(s) in the rendered text: ${missingContact.join(", ")}.`);
  const ok = pageCount >= 1 && pageCount <= expectations.pageLimit && missingSections.length === 0 && missingContact.length === 0 && text.trim().length > 0;
  if (ok) findings.push(`Validated from the rendered bytes: ${pageCount} page(s), required sections and contact details present.`);
  return { ok, pageCount, pageLimit: expectations.pageLimit, missingSections, missingContact, findings: findings.slice(0, 40).map((f) => f.slice(0, 300)) };
}
