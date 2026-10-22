import { pathToFileURL } from "node:url";
import path from "node:path";
import type { ExtractDeps, PdfjsLike } from "@/resume/import/extract";

/**
 * Unit tests run in jsdom/node, where there is no extension origin. They load the pdf.js LEGACY build (no modern-browser
 * requirements) and point its "fake worker" (the worker module run in the main thread, no Worker is started) at the
 * legacy worker file on disk. Production uses the modern build with the worker bundled as an extension file.
 */
export const testDeps: ExtractDeps = {
  loadPdfjs: async () => {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
    return pdfjs;
  },
};

export const FIXED_NOW = new Date("2026-02-03T04:05:06.000Z");
