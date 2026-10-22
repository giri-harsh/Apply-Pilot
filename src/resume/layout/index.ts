import type { LayoutPdfFn, ShortenFn } from "../contracts";
import { LayoutConfigSchema, type LayoutConfig, type LayoutResult, type TailoredResume } from "../schema";
import { resolveFonts, type FontSource } from "./fonts";
import { fitResume } from "./fit";
import { createContext, drawLayout } from "./render";

export { validatePdf, validatePdfWith, extractPdfText } from "./validate";
export type { ValidateDeps } from "./validate";
export { loadDefaultFonts, type FontBytes, type FontSource } from "./fonts";
export { PAGE_SIZES } from "./measure";

export interface LayoutDeps {
  shorten?: ShortenFn;
  /** Font bytes or a loader. Defaults to the bundled Source Sans 3 (lazy). */
  fonts?: FontSource;
}

function unicodeLabel(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Deterministic layout of a tailored resume into a PDF. The engine wraps text with the embedded font's own metrics, so the
 * page count in the result is measured, not estimated; the fit loop (see fit.ts) enforces the page limit within the
 * readability floors and reports every shortened / dropped line.
 */
export async function layoutPdf(tailored: TailoredResume, config: LayoutConfig, deps?: LayoutDeps): Promise<{ bytes: Uint8Array; result: LayoutResult }> {
  const cfg = LayoutConfigSchema.parse(config); // rejects anything below the floors
  const fonts = await resolveFonts(deps?.fonts);
  const ctx = await createContext(fonts);
  const fit = await fitResume(tailored, cfg, ctx.measurer, deps?.shorten);

  const nameLine = fit.resume.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).find((l) => l.role === "name");
  drawLayout(ctx, fit.measured, nameLine ? `${nameLine.text} - Resume` : "Resume");
  const bytes = await ctx.doc.save({ useObjectStreams: false });
  const pageCount = ctx.doc.getPageCount();

  const warnings = [...fit.warnings];
  for (const [cp, n] of [...fit.measured.unsupported.entries()].sort((a, b) => a[0] - b[0])) {
    warnings.push(`Unsupported character ${unicodeLabel(cp)} ("${String.fromCodePoint(cp)}") is not in the embedded font; replaced with "?" in ${n} place(s).`);
  }
  const result: LayoutResult = {
    pageCount,
    finalResume: fit.resume,
    appliedConfig: fit.config,
    droppedLineIds: fit.droppedLineIds,
    shortenedLineIds: fit.shortenedLineIds,
    satisfiedLimit: pageCount <= cfg.pageLimit && fit.satisfiedLimit,
    warnings: warnings.slice(0, 30).map((w) => w.slice(0, 300)),
  };
  return { bytes, result };
}

// Compile-time check that layoutPdf satisfies the shared contract.
const _contract: LayoutPdfFn = layoutPdf;
void _contract;
