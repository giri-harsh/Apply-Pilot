/**
 * Text extraction for each supported format. Extension pages only (options / offscreen): pdfjs and mammoth are
 * lazy-loaded with dynamic import() so the options bundle stays small and the service worker never pulls them in.
 */

export type ExtractedLine = {
  text: string;
  /** The source format marked this line as a heading (DOCX heading style, Markdown #). */
  heading: boolean;
};

export type PdfTextItem = { str?: string; width?: number; height?: number; transform?: number[] };
export type PdfPageLike = { getTextContent(): Promise<{ items: PdfTextItem[] }>; cleanup?: () => void };
export const MAX_IMPORT_PAGES = 30;
export type PdfDocLike = { numPages: number; getPage(n: number): Promise<PdfPageLike>; destroy?: () => Promise<void> | void };
export type PdfjsLike = {
  getDocument(src: unknown): { promise: Promise<PdfDocLike>; destroy?: () => unknown };
  GlobalWorkerOptions: { workerSrc: string };
};
export type MammothLike = { convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: { message: string }[] }> };

export type ExtractDeps = {
  loadPdfjs?: () => Promise<PdfjsLike>;
  loadMammoth?: () => Promise<MammothLike>;
};

/** A gap between text runs wider than this (as a multiple of the font height) is kept as a visible "   " column gap. */
export const WIDE_GAP = "   ";

const BULLET_GLYPH = /^[•▪●◦‣·■⁃]\s*/;
const BULLET_MARK = /^[-*+–]\s+/;

/** Normalises any bullet glyph to a leading "- ". Non-bullet lines are returned trimmed. */
export function normalizeBullet(raw: string): string {
  const t = raw.replace(/^\s+/, "");
  const g = BULLET_GLYPH.exec(t);
  if (g) return `- ${t.slice(g[0].length).trim()}`;
  const m = BULLET_MARK.exec(t);
  if (m) return `- ${t.slice(m[0].length).trim()}`;
  return t.trimEnd();
}

// ------------------------------------------------------------------ PDF

async function defaultLoadPdfjs(): Promise<PdfjsLike> {
  const pdfjs = (await import("pdfjs-dist/build/pdf.mjs")) as unknown as PdfjsLike;
  // The worker is bundled as an extension file (Vite emits it as an asset) and loaded from the extension origin.
  // MV3's CSP allows 'self' scripts, so no CDN is ever used. If the browser still refuses to start a Worker, pdf.js
  // falls back to its in-page "fake worker", which imports this same extension file.
  const asset = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
  const isAbsolute = /^[a-z-]+:\/\//i.test(asset);
  pdfjs.GlobalWorkerOptions.workerSrc = isAbsolute ? asset : chrome.runtime.getURL(asset.replace(/^\.?\//, ""));
  return pdfjs;
}

/** Joins the items of one text line, keeping real word gaps as spaces and column-sized gaps as WIDE_GAP. */
function joinLine(items: PdfTextItem[]): string {
  let out = "";
  let prevEnd: number | null = null;
  let prevStr = "";
  for (const it of items) {
    const raw = it.str ?? "";
    if (raw === "") continue;
    const x = it.transform?.[4] ?? 0;
    const fs = Math.max(it.height ?? 0, 1);
    const trimmed = raw.trim();
    if (trimmed === "") {
      prevStr = " ";
      if (prevEnd !== null) prevEnd = Math.max(prevEnd, x + (it.width ?? 0));
      continue;
    }
    let sep = "";
    if (out !== "") {
      const gap = prevEnd === null ? 0 : x - prevEnd;
      if (gap > 2.5 * fs) sep = WIDE_GAP;
      else if (gap > 0.15 * fs || /\s$/.test(prevStr) || /^\s/.test(raw)) sep = " ";
    }
    out += sep + trimmed;
    prevEnd = x + (it.width ?? 0);
    prevStr = raw;
  }
  return out;
}

export function pdfItemsToLines(items: PdfTextItem[]): string[] {
  const real = items.filter((i) => (i.str ?? "").trim() !== "" && i.transform);
  const sorted = [...real].sort((a, b) => b.transform![5]! - a.transform![5]! || a.transform![4]! - b.transform![4]!);
  const lines: PdfTextItem[][] = [];
  let lineY = Number.POSITIVE_INFINITY;
  for (const it of sorted) {
    const y = it.transform![5]!;
    const tol = Math.max(2, (it.height ?? 10) * 0.4);
    if (lines.length === 0 || lineY - y > tol) {
      lines.push([it]);
      lineY = y;
    } else lines[lines.length - 1]!.push(it);
  }
  return lines.map((l) => joinLine([...l].sort((a, b) => a.transform![4]! - b.transform![4]!)));
}

export async function extractPdf(bytes: Uint8Array, deps: ExtractDeps = {}): Promise<ExtractedLine[]> {
  const pdfjs = await (deps.loadPdfjs ?? defaultLoadPdfjs)();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdf.js detaches the buffer it is given
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const lines: ExtractedLine[] = [];
  try {
    // A resume is a few pages; a file with hundreds is not one, and reading it all could hang the page (verifier finding 12).
    for (let p = 1; p <= Math.min(doc.numPages, MAX_IMPORT_PAGES); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const text of pdfItemsToLines(content.items)) lines.push({ text: normalizeBullet(text), heading: false });
      page.cleanup?.();
    }
  } finally {
    await doc.destroy?.();
  }
  return lines;
}

// ------------------------------------------------------------------ DOCX

async function defaultLoadMammoth(): Promise<MammothLike> {
  const mod = (await import("mammoth/mammoth.browser")) as unknown as { default?: MammothLike } & MammothLike;
  return mod.default ?? mod;
}

function textWithBreaks(node: Node): string {
  let out = "";
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) out += c.textContent ?? "";
    else if ((c as Element).tagName === "BR") out += "\n";
    else out += textWithBreaks(c);
  });
  return out;
}

export function htmlToLines(html: string): ExtractedLine[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines: ExtractedLine[] = [];
  const push = (text: string, heading: boolean, bullet = false) => {
    for (const part of text.split("\n")) {
      const t = part.replace(/ *\t */g, "").replace(/\s+/g, " ").trim().replace(//g, WIDE_GAP);
      if (t) lines.push({ text: bullet ? `- ${t}` : t, heading });
    }
  };
  const list = (ul: Element) => {
    for (const li of Array.from(ul.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      const clone = li.cloneNode(true) as Element;
      clone.querySelectorAll("ul,ol").forEach((n) => n.remove());
      push(textWithBreaks(clone), false, true);
      for (const nested of Array.from(li.children)) if (/^(ul|ol)$/i.test(nested.tagName)) list(nested);
    }
  };
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) push(textWithBreaks(child), true);
      else if (tag === "ul" || tag === "ol") list(child);
      else if (tag === "table") {
        for (const tr of Array.from(child.querySelectorAll("tr"))) {
          const cells = Array.from(tr.children).map((c) => textWithBreaks(c).replace(/\s+/g, " ").trim()).filter(Boolean);
          if (cells.length) lines.push({ text: cells.join(WIDE_GAP), heading: false });
        }
      } else if (tag === "p") push(textWithBreaks(child), false);
      else walk(child);
    }
  };
  walk(doc.body);
  return lines;
}

export async function extractDocx(bytes: Uint8Array, deps: ExtractDeps = {}): Promise<{ lines: ExtractedLine[]; hasTable: boolean }> {
  const mammoth = await (deps.loadMammoth ?? defaultLoadMammoth)();
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
  return { lines: htmlToLines(value), hasTable: /<table/i.test(value) };
}

// ------------------------------------------------------------------ TXT / MD

function stripMarkdownInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");
}

export function extractPlain(text: string, markdown: boolean): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // drop a byte-order mark
  for (const rawLine of body.split(/\r?\n/)) {
    const raw = rawLine.replace(/\t/g, WIDE_GAP).trimEnd();
    if (raw.trim() === "") continue;
    if (markdown) {
      const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
      if (h) {
        lines.push({ text: stripMarkdownInline(h[1] ?? ""), heading: true });
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) continue;
      lines.push({ text: normalizeBullet(stripMarkdownInline(raw)), heading: false });
    } else lines.push({ text: normalizeBullet(raw), heading: false });
  }
  return lines;
}
