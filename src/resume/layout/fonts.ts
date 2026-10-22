/**
 * Embedded font access. The font bytes are an injectable dependency so the (large) TTFs are never part of the
 * service-worker bundle: they are loaded lazily, only when a PDF is actually laid out.
 *
 * Font: Source Sans 3 (SIL Open Font License 1.1, see assets/fonts/OFL-SourceSans3.md).
 */

export type FontBytes = { regular: Uint8Array; bold: Uint8Array };
export type FontSource = FontBytes | (() => Promise<FontBytes>);

export const FONT_FILES = { regular: "SourceSans3-Regular.ttf", bold: "SourceSans3-Bold.ttf" } as const;
/** Path of the font directory inside the built extension (the build must copy assets/fonts/* there). */
export const EXTENSION_FONT_DIR = "assets/fonts/";

let cached: Promise<FontBytes> | null = null;

declare const chrome: { runtime?: { getURL?: (path: string) => string } } | undefined;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed (${res.status}): ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadFromDisk(): Promise<FontBytes> {
  // Variable specifiers keep bundlers from trying to resolve node built-ins for the extension build.
  const fsSpec = "node:fs/promises";
  const urlSpec = "node:url";
  const fs = (await import(/* @vite-ignore */ fsSpec)) as typeof import("node:fs/promises");
  const url = (await import(/* @vite-ignore */ urlSpec)) as typeof import("node:url");
  const dir = new URL("../../../assets/fonts/", import.meta.url);
  const read = async (name: string) => new Uint8Array(await fs.readFile(url.fileURLToPath(new URL(name, dir))));
  return { regular: await read(FONT_FILES.regular), bold: await read(FONT_FILES.bold) };
}

/** Default loader: extension runtime URL when running inside the extension, the repo's assets/fonts directory otherwise (tests, node). */
export function loadDefaultFonts(): Promise<FontBytes> {
  if (!cached) {
    cached = (async () => {
      const getURL = typeof chrome !== "undefined" ? chrome?.runtime?.getURL : undefined;
      if (getURL) {
        const base = (name: string) => getURL.call(chrome?.runtime, EXTENSION_FONT_DIR + name);
        return { regular: await fetchBytes(base(FONT_FILES.regular)), bold: await fetchBytes(base(FONT_FILES.bold)) };
      }
      return loadFromDisk();
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

export async function resolveFonts(source?: FontSource): Promise<FontBytes> {
  if (!source) return loadDefaultFonts();
  return typeof source === "function" ? source() : source;
}
