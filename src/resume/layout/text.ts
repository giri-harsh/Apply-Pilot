/** Text preparation and wrapping. All widths come from the embedded font, so the engine itself decides every line break. */

export interface Measurer {
  /** Width in points of `text` at `size`. */
  width(text: string, bold: boolean, size: number): number;
  /** True when the embedded font has a glyph for the code point. */
  has(codePoint: number): boolean;
}

export type Unsupported = Map<number, number>;

const FALLBACK = "?";
const SPACES = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);
const INVISIBLE = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff]);

/**
 * Makes text safe to draw: whitespace variants become spaces, invisible format characters are removed, and any code point
 * the font lacks is replaced by a visible "?" and counted in `unsupported` (the caller reports it). Never renders .notdef.
 */
export function sanitize(text: string, m: Measurer, unsupported?: Unsupported): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (SPACES.has(cp) || cp < 0x20 || cp === 0x7f) {
      out += " ";
    } else if (INVISIBLE.has(cp) || (cp >= 0xfe00 && cp <= 0xfe0f)) {
      continue;
    } else if (m.has(cp)) {
      out += ch;
    } else {
      out += FALLBACK;
      if (unsupported) unsupported.set(cp, (unsupported.get(cp) ?? 0) + 1);
    }
  }
  return out.replace(/ {2,}/g, " ").trim();
}

export interface Run {
  text: string;
  bold?: boolean;
  url?: string | null;
}

export interface Seg {
  text: string;
  x: number;
  w: number;
  bold: boolean;
  url: string | null;
}

export interface WrappedLine {
  segs: Seg[];
  /** Right edge of the last segment, relative to the line's left edge. */
  width: number;
}

interface Word {
  text: string;
  bold: boolean;
  url: string | null;
  w: number;
  spaceBefore: boolean;
}

function toWords(runs: Run[], size: number, m: Measurer): Word[] {
  const words: Word[] = [];
  let pendingSpace = false;
  for (const run of runs) {
    const bold = run.bold === true;
    const url = run.url ?? null;
    for (const tok of run.text.match(/\S+|\s+/g) ?? []) {
      if (/^\s+$/.test(tok)) {
        pendingSpace = true;
        continue;
      }
      words.push({ text: tok, bold, url, w: m.width(tok, bold, size), spaceBefore: pendingSpace && words.length > 0 });
      pendingSpace = false;
    }
  }
  return words;
}

/** Splits one over-long token (URL, long identifier) into chunks that each fit `avail`, by code point. */
function breakToken(word: Word, size: number, avail: number, m: Measurer): Word[] {
  const chunks: Word[] = [];
  let cur = "";
  for (const ch of word.text) {
    const next = cur + ch;
    if (cur && m.width(next, word.bold, size) > avail) {
      chunks.push({ ...word, text: cur, w: m.width(cur, word.bold, size), spaceBefore: false });
      cur = ch;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push({ ...word, text: cur, w: m.width(cur, word.bold, size), spaceBefore: false });
  if (chunks[0]) chunks[0].spaceBefore = word.spaceBefore;
  return chunks;
}

/**
 * Greedy wrap. `firstWidth` and `restWidth` are the available widths of the first and following lines.
 * No segment ever extends beyond the width of its line; tokens wider than a whole line are broken.
 */
export function wrapRuns(runs: Run[], size: number, firstWidth: number, restWidth: number, m: Measurer): WrappedLine[] {
  const space = m.width(" ", false, size);
  const lines: { words: { word: Word; x: number }[]; x: number }[] = [{ words: [], x: 0 }];
  const avail = () => (lines.length === 1 ? firstWidth : restWidth);
  for (const w of toWords(runs, size, m)) {
    const pieces = w.w > restWidth || w.w > firstWidth ? breakToken(w, size, Math.min(restWidth, firstWidth), m) : [w];
    for (const piece of pieces) {
      let cur = lines[lines.length - 1]!;
      const gap = cur.words.length > 0 && piece.spaceBefore ? space : 0;
      if (cur.words.length > 0 && cur.x + gap + piece.w > avail() + 1e-6) {
        cur = { words: [], x: 0 };
        lines.push(cur);
      }
      const g = cur.words.length > 0 && piece.spaceBefore ? space : 0;
      const x = cur.x + g;
      cur.words.push({ word: piece, x });
      cur.x = x + piece.w;
    }
  }
  return lines.map((ln) => {
    const segs: Seg[] = [];
    for (const { word, x } of ln.words) {
      const last = segs[segs.length - 1];
      if (last && last.bold === word.bold && last.url === word.url && word.spaceBefore) {
        last.text += " " + word.text;
        last.w = x + word.w - last.x;
      } else if (last && last.bold === word.bold && last.url === word.url && !word.spaceBefore) {
        last.text += word.text;
        last.w = x + word.w - last.x;
      } else {
        segs.push({ text: word.text, x, w: word.w, bold: word.bold, url: word.url });
      }
    }
    return { segs, width: ln.x };
  });
}
