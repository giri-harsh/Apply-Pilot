import { describe, expect, it } from "vitest";
import { parseResumeFile, zipUncompressedSize } from "@/resume/import";
import { buildDocx } from "../../fixtures/resumes/files";

/** A zip with one stored entry whose directory claims `declared` uncompressed bytes (nothing is ever expanded). */
function fakeZip(declared: number): Uint8Array {
  const name = new TextEncoder().encode("word/document.xml");
  const cd = new Uint8Array(46 + name.length);
  const v = new DataView(cd.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint32(24, declared, true);
  v.setUint16(28, name.length, true);
  cd.set(name, 46);
  const eocd = new Uint8Array(22);
  const e = new DataView(eocd.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(10, 1, true);
  e.setUint32(12, cd.length, true);
  e.setUint32(16, 0, true); // central directory starts at offset 0
  const out = new Uint8Array(cd.length + eocd.length);
  out.set(cd, 0);
  out.set(eocd, cd.length);
  return out;
}

describe("DOCX size caps", () => {
  it("reads the declared uncompressed size of a real DOCX without expanding it", async () => {
    const bytes = await buildDocx();
    const n = zipUncompressedSize(bytes);
    expect(n).toBeGreaterThan(bytes.length / 2);
    expect(n).toBeLessThan(5_000_000);
  });

  it("a small file that declares a huge expansion is refused before anything is read (configurable cap)", async () => {
    const bomb = fakeZip(3_000_000_000);
    expect(bomb.length).toBeLessThan(200);
    const r = await parseResumeFile({ name: "bomb.docx", bytes: bomb });
    expect(r.draft).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/expands to .* over the .* limit/);

    // the same file passes the size check under a generous configured cap (it is not a real DOCX, so it fails later, honestly)
    const big = await parseResumeFile({ name: "ok.docx", bytes: fakeZip(1_000) }, { maxUncompressedBytes: 10_000 });
    expect(big.warnings.join(" ")).not.toMatch(/expands to/);
    const strict = await parseResumeFile({ name: "ok.docx", bytes: fakeZip(5_000) }, { maxUncompressedBytes: 1_000 });
    expect(strict.warnings.join(" ")).toMatch(/expands to/);
  });

  it("bytes that are not a zip are refused with a clear message, and the compressed cap still applies", async () => {
    const r = await parseResumeFile({ name: "x.docx", bytes: new TextEncoder().encode("not a zip at all, just text") });
    expect(r.warnings.join(" ")).toMatch(/could not be read as a zip/);
    const tiny = await parseResumeFile({ name: "y.docx", bytes: await buildDocx() }, { maxBytes: 100 });
    expect(tiny.warnings.join(" ")).toMatch(/import limit/);
  });
});
