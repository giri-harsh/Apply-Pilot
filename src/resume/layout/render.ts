import { PDFDocument, PDFString, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as fontkitNs from "@pdf-lib/fontkit";
import type { FontBytes } from "./fonts";
import type { MeasuredLayout } from "./measure";
import type { Measurer } from "./text";

/** Fixed timestamps so identical input yields identical bytes. */
export const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");

const TEXT = rgb(0.08, 0.08, 0.08);
const LINK = rgb(0.05, 0.22, 0.55);
const RULE = rgb(0.35, 0.35, 0.35);

// The package is a default-exported object: Node/Vitest expose it on the namespace, a Vite browser bundle on `.default`.
const fontkit = ((fontkitNs as unknown as { default?: typeof fontkitNs }).default ?? fontkitNs) as typeof fontkitNs;

type KitFont = ReturnType<typeof fontkit.create>;
const kitCache = new WeakMap<Uint8Array, KitFont>();

function kitFor(bytes: Uint8Array): KitFont {
  let f = kitCache.get(bytes);
  if (!f) {
    f = fontkit.create(bytes);
    kitCache.set(bytes, f);
  }
  return f;
}

export interface PdfContext {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  measurer: Measurer;
}

/** Creates the document, embeds the (subset) fonts and builds the measurer that both fit loop and renderer share. */
export async function createContext(fonts: FontBytes): Promise<PdfContext> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  // customName fixes the subset tag; pdf-lib would otherwise add a random suffix and break determinism.
  const regular = await doc.embedFont(fonts.regular, { subset: true, customName: "APLTRG+SourceSans3-Regular" });
  const bold = await doc.embedFont(fonts.bold, { subset: true, customName: "APLTBD+SourceSans3-Bold" });
  const kr = kitFor(fonts.regular);
  const kb = kitFor(fonts.bold);
  const cache = new Map<string, number>();
  const measurer: Measurer = {
    width(text, isBold, size) {
      if (!text) return 0;
      const key = (isBold ? "b" : "r") + text;
      let w = cache.get(key);
      if (w === undefined) {
        w = (isBold ? bold : regular).widthOfTextAtSize(text, 1000);
        cache.set(key, w);
      }
      return (w * size) / 1000;
    },
    // Both weights must cover the code point, or bold text could show a missing-glyph box.
    has: (cp) => kr.hasGlyphForCodePoint(cp) && kb.hasGlyphForCodePoint(cp),
  };
  return { doc, regular, bold, measurer };
}

function addLink(page: PDFPage, doc: PDFDocument, url: string, x: number, y: number, w: number, h: number) {
  const ctx = doc.context;
  let safe: string;
  try {
    safe = encodeURI(decodeURI(url));
  } catch {
    safe = encodeURI(url);
  }
  const annot = ctx.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(safe) },
  });
  page.node.addAnnot(ctx.register(annot));
}

export function drawLayout(ctx: PdfContext, layout: MeasuredLayout, title: string): void {
  const { doc } = ctx;
  doc.setTitle(title);
  doc.setProducer("ApplyPilot AI");
  doc.setCreator("ApplyPilot AI");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  for (const placed of layout.pages) {
    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    const m = layout.margin;
    for (const line of placed) {
      const baseline = layout.pageHeight - m - line.top - (line.lead - line.size) / 2 - line.size * 0.78;
      const drawSeg = (seg: { text: string; x: number; w: number; bold: boolean; url: string | null }, left: number) => {
        const font = seg.bold ? ctx.bold : ctx.regular;
        const x = left + seg.x;
        page.drawText(seg.text, { x, y: baseline, size: line.size, font, color: seg.url ? LINK : TEXT });
        if (seg.url) addLink(page, doc, seg.url, x, baseline - line.size * 0.25, seg.w, line.size * 1.0);
      };
      if (line.marker) page.drawText(line.marker, { x: m + line.x - line.size * 0.9 - 2, y: baseline, size: line.size, font: ctx.regular, color: TEXT });
      for (const seg of line.segs) drawSeg(seg, m + line.x);
      if (line.right) drawSeg(line.right, m);
      if (line.rule) {
        const y = baseline - line.size * 0.28;
        page.drawLine({ start: { x: m, y }, end: { x: layout.pageWidth - m, y }, thickness: 0.6, color: RULE });
      }
    }
  }
}
