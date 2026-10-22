import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from "pdf-lib";

export interface PlacedText {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
}

/** Positioned text of every page, extracted with pdfjs (legacy build, node, no real worker). */
export async function positionedText(bytes: Uint8Array): Promise<{ items: PlacedText[]; pageWidths: number[]; pageHeights: number[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const items: PlacedText[] = [];
  const pageWidths: number[] = [];
  const pageHeights: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    pageWidths.push(vp.width);
    pageHeights.push(vp.height);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if ("str" in it && it.str.trim()) items.push({ page: p, str: it.str, x: it.transform[4]!, y: it.transform[5]!, width: it.width });
    }
  }
  await task.destroy();
  return { items, pageWidths, pageHeights };
}

/** URIs of the link annotations on each page, read from the PDF structure. */
export async function linkUris(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
    const out: string[] = [];
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const a = annots!.lookup(i, PDFDict);
      const action = a.lookup(PDFName.of("A"), PDFDict);
      const uri = action.lookup(PDFName.of("URI"), PDFString);
      out.push(uri.decodeText());
    }
    return out;
  });
}
