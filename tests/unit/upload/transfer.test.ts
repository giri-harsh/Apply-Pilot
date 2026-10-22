import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleUpload, resetUploadState } from "@/content/upload";
import { kindFromFilename, TransferStore } from "@/content/upload/transfer";
import { observeForm } from "@/content/observer/observe";
import type { UploadContext } from "@/resume/contracts";
import { UPLOAD_CHUNK_BYTES } from "@/resume/messages";

const b64 = (bytes: number[] | Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const meta = (over: Partial<Parameters<TransferStore["begin"]>[0]> = {}) => ({ transferId: "tr-aaaaaaaa", fieldId: "field_001", filename: "A_Resume_B.pdf", mime: "application/pdf", size: 6, chunkCount: 2, ...over });

describe("kindFromFilename convention", () => {
  const table: [string, "resume" | "cover_letter" | null][] = [
    ["Alex_Resume_Acme.pdf", "resume"],
    ["alex_resume_acme.PDF", "resume"],
    ["Alex_Resume.docx", "resume"],
    ["Resume_Alex.pdf", "resume"],
    ["Alex_CoverLetter_Acme.pdf", "cover_letter"],
    ["alex_coverletter_acme.docx", "cover_letter"],
    ["Alex_CoverLetter.pdf", "cover_letter"],
    ["Alex_Resume_CoverLetter_Acme.pdf", null],
    ["transcript.pdf", null],
    ["MyResumeFinal.pdf", null],
    ["Alex Resume.pdf", null],
    ["Alex_Resumes_Acme.pdf", null],
  ];
  it.each(table)("%s -> %s", (name, kind) => expect(kindFromFilename(name)).toBe(kind));
});

describe("TransferStore", () => {
  let s: TransferStore;
  beforeEach(() => {
    vi.useFakeTimers();
    s = new TransferStore(1000);
  });
  afterEach(() => {
    s.clear();
    vi.useRealTimers();
  });

  it("reassembles chunks in order", () => {
    expect(s.begin(meta())).toEqual({ ok: true });
    expect(s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]))).toEqual({ ok: true, received: 1 });
    expect(s.chunk("tr-aaaaaaaa", 1, b64([4, 5, 6]))).toEqual({ ok: true, received: 2 });
    const done = s.commit("tr-aaaaaaaa");
    expect(done.ok && Array.from(done.bytes)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.size).toBe(0);
  });
  it("rejects unknown transfer ids for chunk and commit", () => {
    expect(s.chunk("nope-nope", 0, b64([1]))).toMatchObject({ ok: false });
    expect(s.commit("nope-nope")).toMatchObject({ ok: false });
  });
  it("rejects an out-of-order chunk and destroys the transfer", () => {
    s.begin(meta());
    expect(s.chunk("tr-aaaaaaaa", 1, b64([1, 2, 3]))).toMatchObject({ ok: false, message: expect.stringMatching(/out-of-order/i) });
    expect(s.size).toBe(0);
  });
  it("rejects a duplicate chunk", () => {
    s.begin(meta());
    s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]));
    expect(s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]))).toMatchObject({ ok: false, message: expect.stringMatching(/duplicate/i) });
    expect(s.size).toBe(0);
  });
  it("rejects a commit with a missing chunk", () => {
    s.begin(meta());
    s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]));
    expect(s.commit("tr-aaaaaaaa")).toMatchObject({ ok: false, message: expect.stringMatching(/Expected 2 chunks but received 1/) });
    expect(s.size).toBe(0);
  });
  it("rejects a total size that differs from the declared size", () => {
    s.begin(meta({ size: 10 }));
    s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]));
    s.chunk("tr-aaaaaaaa", 1, b64([4, 5, 6]));
    expect(s.commit("tr-aaaaaaaa")).toMatchObject({ ok: false, message: expect.stringMatching(/Declared 10 bytes/) });
  });
  it("rejects data beyond the declared size", () => {
    s.begin(meta({ size: 4 }));
    s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]));
    expect(s.chunk("tr-aaaaaaaa", 1, b64([4, 5, 6]))).toMatchObject({ ok: false });
    expect(s.size).toBe(0);
  });
  it("rejects invalid base64 and chunks above the chunk size", () => {
    s.begin(meta());
    expect(s.chunk("tr-aaaaaaaa", 0, "!!!not base64!!!")).toMatchObject({ ok: false });
    s.begin(meta({ size: UPLOAD_CHUNK_BYTES + 10, chunkCount: 2 }));
    expect(s.chunk("tr-aaaaaaaa", 0, b64(new Uint8Array(UPLOAD_CHUNK_BYTES + 1)))).toMatchObject({ ok: false });
  });
  it("allows only one in-flight transfer per field and rejects a reused id", () => {
    expect(s.begin(meta())).toEqual({ ok: true });
    expect(s.begin(meta({ transferId: "tr-bbbbbbbb" }))).toMatchObject({ ok: false });
    expect(s.begin(meta({ fieldId: "field_002" }))).toMatchObject({ ok: false, message: expect.stringMatching(/already in use/) });
    expect(s.begin(meta({ transferId: "tr-cccccccc", fieldId: "field_002" }))).toEqual({ ok: true });
  });
  it("rejects a chunk count that cannot hold the size", () => {
    expect(s.begin(meta({ size: UPLOAD_CHUNK_BYTES * 3, chunkCount: 2 }))).toMatchObject({ ok: false });
  });
  it("frees an idle transfer after the timeout", () => {
    s.begin(meta());
    s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]));
    vi.advanceTimersByTime(1500);
    expect(s.size).toBe(0);
    expect(s.chunk("tr-aaaaaaaa", 1, b64([4, 5, 6]))).toMatchObject({ ok: false });
  });
  it("abort frees the buffers and is idempotent", () => {
    s.begin(meta());
    s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]));
    expect(s.abort("tr-aaaaaaaa")).toBe(1);
    expect(s.abort("tr-aaaaaaaa")).toBe(0);
    expect(s.size).toBe(0);
  });
  it("a committed transfer cannot be committed again", () => {
    s.begin(meta({ size: 3, chunkCount: 1 }));
    s.chunk("tr-aaaaaaaa", 0, b64([1, 2, 3]));
    expect(s.commit("tr-aaaaaaaa").ok).toBe(true);
    expect(s.commit("tr-aaaaaaaa")).toMatchObject({ ok: false });
  });
});

describe("handleUpload policy (no DOM upload reached)", () => {
  function ctx(html: string): UploadContext {
    document.body.innerHTML = html;
    const o = observeForm(document);
    return { doc: document, fields: o.fields, elementsFor: (id) => o.targets.get(id) };
  }
  async function transfer(c: UploadContext, fieldId: string, filename: string, bytes = [1, 2, 3]) {
    const transferId = `tr-${Math.random().toString(36).slice(2, 12)}`;
    const begin = await handleUpload({ kind: "UPLOAD_BEGIN", transferId, fieldId, filename, mime: "application/pdf", size: bytes.length, chunkCount: 1 }, c);
    expect(begin).toMatchObject({ ok: true, kind: "UPLOAD_ACK" });
    await handleUpload({ kind: "UPLOAD_CHUNK", transferId, index: 0, dataB64: b64(bytes) }, c);
    return handleUpload({ kind: "UPLOAD_COMMIT", transferId }, c);
  }
  beforeEach(() => resetUploadState());

  const html = `<form>
    <div><label for="r">Resume</label><input type="file" id="r"></div>
    <div><label for="c">Cover letter</label><input type="file" id="c"></div>
    <div><label for="t">Transcript</label><input type="file" id="t"></div>
    <div><label for="g">Attach a file</label><input type="file" id="g"></div></form>`;

  it("lists inputs with their classification", async () => {
    const c = ctx(html);
    const r = await handleUpload({ kind: "UPLOAD_LIST" }, c);
    expect(r).toMatchObject({ ok: true, kind: "UPLOAD_FIELDS" });
    if (!r.ok || r.kind !== "UPLOAD_FIELDS") throw new Error("unexpected");
    expect(r.fields.map((f) => f.classification)).toEqual(["resume", "cover_letter", "other", "ambiguous"]);
    expect(r.fields.every((f) => !f.hasFile)).toBe(true);
  });
  it("refuses to put a resume into cover-letter, other or ambiguous fields, and attaches nothing", async () => {
    const c = ctx(html);
    for (const [fieldId, cls] of [["field_002", "cover_letter"], ["field_003", "other"], ["field_004", "ambiguous"]] as const) {
      const r = await transfer(c, fieldId, "Alex_Resume_Acme.pdf");
      expect(r).toMatchObject({ ok: true, kind: "UPLOADED", result: { status: "skipped", classification: cls } });
    }
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("input")).map((i) => i.files?.length ?? 0)).toEqual([0, 0, 0, 0]);
  });
  it("refuses a cover letter in the resume field", async () => {
    const c = ctx(html);
    const r = await transfer(c, "field_001", "Alex_CoverLetter_Acme.pdf");
    expect(r).toMatchObject({ result: { status: "skipped", classification: "resume" } });
  });
  it("refuses a file whose role cannot be told from its name", async () => {
    const c = ctx(html);
    const r = await transfer(c, "field_001", "document.pdf");
    expect(r).toMatchObject({ result: { status: "skipped", reason: expect.stringMatching(/role/) } });
  });
  it("refuses a file that the field's accept list does not admit", async () => {
    const c = ctx(`<label for="r">Resume</label><input type="file" id="r" accept="image/*">`);
    const r = await transfer(c, "field_001", "Alex_Resume_Acme.pdf");
    expect(r).toMatchObject({ result: { status: "skipped", reason: expect.stringMatching(/accepts/) } });
  });
  it("rejects a transfer to an unknown or non-file field", async () => {
    const c = ctx(`<label for="n">Name</label><input id="n"><label for="r">Resume</label><input type="file" id="r">`);
    for (const fieldId of ["field_099", "field_001"]) {
      const r = await handleUpload({ kind: "UPLOAD_BEGIN", transferId: "tr-12345678", fieldId, filename: "A_Resume_B.pdf", mime: "application/pdf", size: 3, chunkCount: 1 }, c);
      expect(r).toMatchObject({ ok: false });
    }
  });
  it("answers integrity failures with an error and leaves the input empty", async () => {
    const c = ctx(`<label for="r">Resume</label><input type="file" id="r">`);
    const begin = { kind: "UPLOAD_BEGIN" as const, transferId: "tr-integrity", fieldId: "field_001", filename: "A_Resume_B.pdf", mime: "application/pdf", size: 6, chunkCount: 2 };
    await handleUpload(begin, c);
    await handleUpload({ kind: "UPLOAD_CHUNK", transferId: "tr-integrity", index: 0, dataB64: b64([1, 2, 3]) }, c);
    expect(await handleUpload({ kind: "UPLOAD_COMMIT", transferId: "tr-integrity" }, c)).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
    expect(await handleUpload({ kind: "UPLOAD_COMMIT", transferId: "tr-unknown1" }, c)).toMatchObject({ ok: false });
    expect(document.querySelector<HTMLInputElement>("input")!.files!.length).toBe(0);
  });
  it("never exposes bytes on window or the DOM", async () => {
    const c = ctx(html);
    const before = Object.keys(window).length;
    await transfer(c, "field_003", "Alex_Resume_Acme.pdf", [7, 7, 7]);
    expect(Object.keys(window).length).toBe(before);
    expect(document.documentElement.outerHTML).not.toMatch(/data-|AAAA/);
  });
});
