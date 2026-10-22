import { exportDocx } from "@/resume/export";
import { layoutPdf, validatePdfWith } from "@/resume/layout";
import { OffscreenRequestSchema, ShortenResponseSchema, type OffscreenResponse } from "@/resume/offscreen-protocol";
import type { FileRef, TailoredLine } from "@/resume/schema";
import { createResumeStore } from "@/resume/storage";
import type { ShortenFn } from "@/resume/contracts";

/**
 * Document builder (SPEC 7.6). Lives in an offscreen document so the service worker stays lean and pdf-lib / pdfjs get
 * a DOM-capable page. It never calls an AI provider and never sees a key: when the fit loop wants shorter wording it
 * asks the service worker (RESUME_SHORTEN), which owns the providers.
 */

const store = createResumeStore();

function shortenVia(sessionId: string): ShortenFn {
  return async (lines: TailoredLine[], target) => {
    try {
      const raw: unknown = await chrome.runtime.sendMessage({ kind: "RESUME_SHORTEN", sessionId, lines, target });
      const parsed = ShortenResponseSchema.safeParse(raw);
      return parsed.success ? parsed.data.lines : lines;
    } catch {
      return lines; // no shorter wording available: the fit loop moves on to spacing and dropping
    }
  };
}

async function build(raw: unknown): Promise<OffscreenResponse> {
  const req = OffscreenRequestSchema.safeParse(raw);
  if (!req.success) return { ok: false, message: "Invalid build request" };
  const r = req.data;
  try {
    const { bytes, result } = await layoutPdf(r.tailored, r.config, { shorten: shortenVia(r.sessionId) });
    const validation = await validatePdfWith(
      bytes,
      {
        pageLimit: r.config.pageLimit,
        requiredSections: result.finalResume.sections.filter((s) => s.key !== "header").map((s) => s.title),
        contact: r.contact,
      },
      { workerSrc: chrome.runtime.getURL("pdf.worker.mjs") },
    );
    const now = new Date().toISOString();
    const pdf: FileRef = {
      fileId: crypto.randomUUID(),
      filename: r.filename,
      mime: "application/pdf",
      size: bytes.byteLength,
      format: "pdf",
      pageValidated: validation.pageCount > 0,
      createdAt: now,
    };
    await store.putBinary(pdf, bytes);
    let docx: FileRef | null = null;
    if (r.docxFilename) {
      const docBytes = await exportDocx(result.finalResume, result.appliedConfig);
      docx = {
        fileId: crypto.randomUUID(),
        filename: r.docxFilename,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: docBytes.byteLength,
        format: "docx",
        pageValidated: false, // a DOCX page count is not validated
        createdAt: now,
      };
      await store.putBinary(docx, docBytes);
    }
    return { ok: true, layout: result, validation, pdf, docx };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : "Document build failed").slice(0, 300) };
  }
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  // Only the extension's own pages (the service worker has no URL): a content script of this extension is rejected.
  if (sender.id !== chrome.runtime.id || (sender.url !== undefined && !sender.url.startsWith(chrome.runtime.getURL("")))) return false;
  if ((raw as { target?: string } | null)?.target !== "offscreen") return false;
  void build(raw).then(sendResponse);
  return true;
});
