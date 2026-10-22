import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { launchExtension, portalUrl, tabIdFor, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";
import { UPLOAD_CHUNK_BYTES } from "../../src/resume/messages";

/**
 * Drives the content script's upload module directly from the extension service worker (the LEAD's harness is wired
 * later): inject content.js, OBSERVE, then exchange UPLOAD_* messages with the real chunked base64 protocol.
 */

type Msg = Record<string, unknown>;
type Resp = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type UploadedResult = { fieldId: string; status: string; classification: string; reason: string; filename: string | null; warnings: string[] };

const MIME_PDF = "application/pdf";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText("Alex Example resume");
  return doc.save();
}

const send = (tabId: number, msg: Msg): Promise<Resp> => ext.worker.evaluate(([id, m]) => chrome.tabs.sendMessage(id as number, m), [tabId, msg] as const) as Promise<Resp>;

async function open(name: string): Promise<{ page: Page; tabId: number; fields: Resp[] }> {
  const page = await ext.context.newPage();
  await page.goto(portalUrl(`upload/${name}`));
  const tabId = await tabIdFor(ext, page);
  await ext.worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  const obs = await send(tabId, { kind: "OBSERVE" });
  expect(obs.ok).toBe(true);
  const listed = await send(tabId, { kind: "UPLOAD_LIST" });
  expect(listed).toMatchObject({ ok: true, kind: "UPLOAD_FIELDS" });
  return { page, tabId, fields: listed.fields };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
let seq = 0;
const newId = () => `tr-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

/** The full protocol: BEGIN, every chunk, COMMIT. Returns the COMMIT response. */
async function upload(tabId: number, fieldId: string, filename: string, mime: string, bytes: Uint8Array): Promise<Resp> {
  const transferId = newId();
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += UPLOAD_CHUNK_BYTES) chunks.push(bytes.subarray(at, at + UPLOAD_CHUNK_BYTES));
  const begin = await send(tabId, { kind: "UPLOAD_BEGIN", transferId, fieldId, filename, mime, size: bytes.length, chunkCount: chunks.length });
  expect(begin).toMatchObject({ ok: true, kind: "UPLOAD_ACK", received: 0 });
  for (const [index, c] of chunks.entries()) {
    expect(await send(tabId, { kind: "UPLOAD_CHUNK", transferId, index, dataB64: b64(c) })).toMatchObject({ ok: true, received: index + 1 });
  }
  return send(tabId, { kind: "UPLOAD_COMMIT", transferId });
}
const result = (r: Resp): UploadedResult => {
  expect(r).toMatchObject({ ok: true, kind: "UPLOADED" });
  return r.result as UploadedResult;
};

const fileCounts = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>("input[type=file]")).map((i) => i.files?.length ?? 0));
const fileName = (page: Page, sel: string) => page.evaluate((s) => document.querySelector<HTMLInputElement>(s)?.files?.[0]?.name ?? null, sel);
const status = (page: Page, sel = "#status") => page.locator(sel).getAttribute("data-state");

const RESUME = "Alex_Resume_Acme.pdf";
const COVER = "Alex_CoverLetter_Acme.pdf";
const DOCX = "Alex_Resume_Acme.docx";

test.describe("Phase 7: file upload in the content script", () => {
  test("a plain resume input is classified, filled with the exact bytes and verified", async () => {
    const pdf = await makePdf();
    const { page, tabId, fields } = await open("resume-basic");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ classification: "resume", required: true, hasFile: false, label: "Resume" });
    const r = result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, pdf));
    expect(r).toMatchObject({ status: "uploaded_verified", classification: "resume", filename: RESUME, warnings: [] });
    expect(await fileName(page, "#resume")).toBe(RESUME);
    expect(await status(page)).toBe("attached");
    const sent = await page.evaluate(async () => Array.from(new Uint8Array(await document.querySelector<HTMLInputElement>("#resume")!.files![0]!.arrayBuffer())));
    expect(sent).toEqual(Array.from(pdf));
    expect(await page.evaluate(() => (window as unknown as { __uploads: { type: string }[] }).__uploads)).toMatchObject([{ type: MIME_PDF }]);
    // The list now reports the field as holding a file.
    const again = await send(tabId, { kind: "UPLOAD_LIST" });
    expect(again.fields[0].hasFile).toBe(true);
  });

  test("a file larger than one chunk arrives intact", async () => {
    const big = new Uint8Array(UPLOAD_CHUNK_BYTES * 2 + 123);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 255;
    const { page, tabId, fields } = await open("resume-basic");
    const r = result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, big));
    expect(r.status).toBe("uploaded_verified");
    const check = await page.evaluate(async () => {
      const b = new Uint8Array(await document.querySelector<HTMLInputElement>("#resume")!.files![0]!.arrayBuffer());
      let sum = 0;
      for (let i = 0; i < b.length; i++) sum = (sum * 31 + b[i]!) >>> 0;
      return { length: b.length, sum };
    });
    let expected = 0;
    for (const b of big) expected = (expected * 31 + b) >>> 0;
    expect(check).toEqual({ length: big.length, sum: expected });
  });

  test("a hidden input behind a drop zone is filled and the shown filename is the evidence", async () => {
    const { page, tabId, fields } = await open("dropzone-hidden");
    expect(fields[0]).toMatchObject({ classification: "resume", accept: ".pdf,.docx" });
    const r = result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf()));
    expect(r.status).toBe("uploaded_verified");
    expect(await page.locator("#file-name").textContent()).toBe(RESUME);
  });

  test("resume and cover letter inputs each get their own file; a resume never lands in the cover letter input", async () => {
    const pdf = await makePdf();
    const { page, tabId, fields } = await open("resume-and-cover");
    expect(fields.map((f) => f.classification)).toEqual(["resume", "cover_letter"]);
    const [resumeField, coverField] = fields as [Resp, Resp];

    const wrong = result(await upload(tabId, coverField.fieldId, RESUME, MIME_PDF, pdf));
    expect(wrong).toMatchObject({ status: "skipped", classification: "cover_letter" });
    expect(await fileCounts(page)).toEqual([0, 0]);

    const wrong2 = result(await upload(tabId, resumeField.fieldId, COVER, MIME_PDF, pdf));
    expect(wrong2).toMatchObject({ status: "skipped", classification: "resume" });
    expect(await fileCounts(page)).toEqual([0, 0]);

    expect(result(await upload(tabId, resumeField.fieldId, RESUME, MIME_PDF, pdf)).status).toBe("uploaded_verified");
    expect(result(await upload(tabId, coverField.fieldId, COVER, MIME_PDF, pdf)).status).toBe("uploaded_verified");
    expect(await fileName(page, "#resume")).toBe(RESUME);
    expect(await fileName(page, "#cover")).toBe(COVER);
  });

  test("a file without a recognisable role is never uploaded", async () => {
    const { page, tabId, fields } = await open("resume-basic");
    const r = result(await upload(tabId, fields[0]!.fieldId, "document.pdf", MIME_PDF, await makePdf()));
    expect(r.status).toBe("skipped");
    expect(await fileCounts(page)).toEqual([0]);
  });

  test("resume never lands in transcript / portfolio inputs; only the resume input is filled", async () => {
    const pdf = await makePdf();
    const { page, tabId, fields } = await open("other-fields");
    expect(fields.map((f) => f.classification)).toEqual(["other", "other", "resume"]);
    for (const f of fields.slice(0, 2)) {
      expect(result(await upload(tabId, f.fieldId, RESUME, MIME_PDF, pdf))).toMatchObject({ status: "skipped", classification: "other" });
    }
    expect(await fileCounts(page)).toEqual([0, 0, 0]);
    expect(result(await upload(tabId, fields[2]!.fieldId, RESUME, MIME_PDF, pdf)).status).toBe("uploaded_verified");
    expect(await fileCounts(page)).toEqual([0, 0, 1]);
  });

  test("generic, mixed-wording and instruction-like labels are ambiguous and skipped, never guessed", async () => {
    const pdf = await makePdf();
    const { page, tabId, fields } = await open("ambiguous");
    expect(fields.map((f) => f.classification)).toEqual(["ambiguous", "ambiguous", "ambiguous"]);
    for (const f of fields) expect(f.reason.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(result(await upload(tabId, f.fieldId, RESUME, MIME_PDF, pdf))).toMatchObject({ status: "skipped", classification: "ambiguous" });
    }
    expect(await fileCounts(page)).toEqual([0, 0, 0]);
  });

  test("two inputs that both look like the resume are both ambiguous", async () => {
    const { page, tabId, fields } = await open("two-resumes");
    expect(fields.map((f) => f.classification)).toEqual(["ambiguous", "ambiguous"]);
    expect(fields[0]!.reason).toMatch(/none is clearly primary/);
    expect(result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf())).status).toBe("skipped");
    expect(await fileCounts(page)).toEqual([0, 0]);
  });

  test.describe("accept rules", () => {
    test("PDF-only input takes the PDF and refuses a DOCX", async () => {
      const { page, tabId, fields } = await open("accept-pdf");
      expect(fields[0]!.accept).toBe(".pdf");
      expect(result(await upload(tabId, fields[0]!.fieldId, DOCX, MIME_DOCX, new Uint8Array([80, 75, 3, 4, 1, 2]))).status).toBe("skipped");
      expect(await fileCounts(page)).toEqual([0]);
      expect(result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf())).status).toBe("uploaded_verified");
    });
    test("DOCX-only input takes the DOCX with a not-page-validated warning, and refuses a PDF", async () => {
      const { page, tabId, fields } = await open("accept-docx");
      expect(result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf())).status).toBe("skipped");
      expect(await fileCounts(page)).toEqual([0]);
      const r = result(await upload(tabId, fields[0]!.fieldId, DOCX, MIME_DOCX, new Uint8Array([80, 75, 3, 4, 1, 2])));
      expect(r.status).toBe("uploaded_verified");
      expect(r.warnings.join(" ")).toMatch(/not page-validated/);
      expect(await fileName(page, "#resume")).toBe(DOCX);
    });
    test("an images-only input accepts neither format: skipped and reported, nothing attached", async () => {
      const { page, tabId, fields } = await open("accept-image");
      expect(fields[0]).toMatchObject({ classification: "resume", accept: "image/*" });
      const r = result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf()));
      expect(r.status).toBe("skipped");
      expect(r.reason).toMatch(/accepts/);
      expect(await fileCounts(page)).toEqual([0]);
      expect(await status(page)).toBe("empty");
    });
  });

  test("a site that ignores change events but understands a drop on its zone is recognised via the drop fallback", async () => {
    const { page, tabId, fields } = await open("ignores-change");
    const r = result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf()));
    expect(r.status).toBe("uploaded_verified");
    expect(r.reason).toMatch(/drop/);
    expect(await page.evaluate(() => (window as unknown as { __drops: number }).__drops)).toBe(1);
    expect(await page.locator("#status").textContent()).toBe(RESUME);
  });

  test("a site that shows an error for the upload is not verified and the error text is reported", async () => {
    const { page, tabId, fields } = await open("upload-error");
    const r = result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf()));
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("this file could not be read");
    expect(await status(page)).toBe("error");
  });

  test("a second commit to the same field is skipped and attaches nothing more", async () => {
    const pdf = await makePdf();
    const { page, tabId, fields } = await open("resume-basic");
    expect(result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, pdf)).status).toBe("uploaded_verified");
    const second = result(await upload(tabId, fields[0]!.fieldId, "Alex_Resume_Other.pdf", MIME_PDF, pdf));
    expect(second).toMatchObject({ status: "skipped", reason: "already uploaded this run" });
    expect(await fileName(page, "#resume")).toBe(RESUME);
    expect(await page.evaluate(() => (window as unknown as { __uploads: unknown[] }).__uploads.length)).toBe(1);
  });

  test("a field that already holds a file is not replaced", async () => {
    const { page, tabId } = await open("resume-basic");
    await page.locator("#resume").setInputFiles({ name: "mine.pdf", mimeType: MIME_PDF, buffer: Buffer.from("%PDF-1.4 mine") });
    const obs = await send(tabId, { kind: "OBSERVE" });
    expect(obs.ok).toBe(true);
    const listed = await send(tabId, { kind: "UPLOAD_LIST" });
    expect(listed.fields[0].hasFile).toBe(true);
    const r = result(await upload(tabId, listed.fields[0].fieldId, RESUME, MIME_PDF, await makePdf()));
    expect(r.status).toBe("skipped");
    expect(await fileName(page, "#resume")).toBe("mine.pdf");
  });

  test.describe("chunk integrity", () => {
    const begin = (tabId: number, fieldId: string, transferId: string, size: number, chunkCount: number) =>
      send(tabId, { kind: "UPLOAD_BEGIN", transferId, fieldId, filename: RESUME, mime: MIME_PDF, size, chunkCount });
    const chunk = (tabId: number, transferId: string, index: number, bytes: Uint8Array) => send(tabId, { kind: "UPLOAD_CHUNK", transferId, index, dataB64: b64(bytes) });
    const three = new Uint8Array([1, 2, 3]);

    test("a missing chunk is rejected at commit and nothing is attached", async () => {
      const { page, tabId, fields } = await open("resume-basic");
      const id = newId();
      expect((await begin(tabId, fields[0]!.fieldId, id, 6, 2)).ok).toBe(true);
      expect((await chunk(tabId, id, 0, three)).ok).toBe(true);
      expect(await send(tabId, { kind: "UPLOAD_COMMIT", transferId: id })).toMatchObject({ ok: false });
      expect(await fileCounts(page)).toEqual([0]);
      // The transfer is gone: the same id cannot be continued.
      expect(await chunk(tabId, id, 1, three)).toMatchObject({ ok: false });
    });
    test("a wrong total size is rejected at commit", async () => {
      const { page, tabId, fields } = await open("resume-basic");
      const id = newId();
      await begin(tabId, fields[0]!.fieldId, id, 9, 2);
      await chunk(tabId, id, 0, three);
      await chunk(tabId, id, 1, three);
      expect(await send(tabId, { kind: "UPLOAD_COMMIT", transferId: id })).toMatchObject({ ok: false });
      expect(await fileCounts(page)).toEqual([0]);
    });
    test("an unknown transfer id is rejected for chunk and commit", async () => {
      const { page, tabId } = await open("resume-basic");
      expect(await chunk(tabId, "tr-unknown-id", 0, three)).toMatchObject({ ok: false });
      expect(await send(tabId, { kind: "UPLOAD_COMMIT", transferId: "tr-unknown-id" })).toMatchObject({ ok: false });
      expect(await fileCounts(page)).toEqual([0]);
    });
    test("an out-of-order or duplicate chunk destroys the transfer", async () => {
      const { page, tabId, fields } = await open("resume-basic");
      const a = newId();
      await begin(tabId, fields[0]!.fieldId, a, 6, 2);
      expect(await chunk(tabId, a, 1, three)).toMatchObject({ ok: false });
      expect(await send(tabId, { kind: "UPLOAD_COMMIT", transferId: a })).toMatchObject({ ok: false });
      const b = newId();
      await begin(tabId, fields[0]!.fieldId, b, 6, 2);
      await chunk(tabId, b, 0, three);
      expect(await chunk(tabId, b, 0, three)).toMatchObject({ ok: false });
      expect(await send(tabId, { kind: "UPLOAD_COMMIT", transferId: b })).toMatchObject({ ok: false });
      expect(await fileCounts(page)).toEqual([0]);
    });
    test("a second transfer for the same field is rejected while one is in flight; abort frees it", async () => {
      const { page, tabId, fields } = await open("resume-basic");
      const a = newId();
      expect((await begin(tabId, fields[0]!.fieldId, a, 3, 1)).ok).toBe(true);
      expect(await begin(tabId, fields[0]!.fieldId, newId(), 3, 1)).toMatchObject({ ok: false });
      expect(await send(tabId, { kind: "UPLOAD_ABORT", transferId: a })).toMatchObject({ ok: true, kind: "UPLOAD_ACK" });
      expect(await send(tabId, { kind: "UPLOAD_COMMIT", transferId: a })).toMatchObject({ ok: false });
      // After the failures a clean transfer still works.
      expect(result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf())).status).toBe("uploaded_verified");
      expect(await fileCounts(page)).toEqual([1]);
    });
  });

  test("auto-parse: site-filled values are inspected after upload and never overwritten", async () => {
    const { page, tabId, fields } = await open("autoparse");
    expect(result(await upload(tabId, fields[0]!.fieldId, RESUME, MIME_PDF, await makePdf())).status).toBe("uploaded_verified");
    await expect.poll(() => page.locator("#status").getAttribute("data-state")).toBe("parsed");
    expect(await page.locator("#fullname").inputValue()).toBe("Alexander J. Example");

    // The LEAD re-observes after the upload, then maps with the profile ("Alex Example", alex@example.test, Pune).
    const obs = await send(tabId, { kind: "OBSERVE" });
    const byLabel = (label: string) => obs.fields.find((f: Resp) => f.label === label);
    expect(byLabel("Full name").currentValue).toBe("Alexander J. Example");
    const mapped = await send(tabId, { kind: "MAP", profile: testProfile() });
    expect(mapped).toMatchObject({ ok: true, kind: "MAPPED" });
    const planned = (label: string) => mapped.plan.some((p: Resp) => p.fieldId === byLabel(label).fieldId);
    const skipped = (label: string) => mapped.skipped.find((s: Resp) => s.fieldId === byLabel(label).fieldId);

    // Differing site value: not planned, reported as unresolved and not overwritten.
    expect(planned("Full name")).toBe(false);
    expect(skipped("Full name")).toMatchObject({ outcome: "unresolved" });
    expect(skipped("Full name").reason).toMatch(/already has a different value; not overwritten/i);
    // Correct site value: left alone.
    expect(planned("Email")).toBe(false);
    expect(skipped("Email")).toMatchObject({ outcome: "already_correct" });
    // Empty field is still filled from the profile.
    expect(planned("City")).toBe(true);

    // Executing the plan really leaves the site's values alone.
    const exec = await send(tabId, { kind: "EXECUTE", plan: mapped.plan });
    expect(exec.ok).toBe(true);
    expect(await page.locator("#fullname").inputValue()).toBe("Alexander J. Example");
    expect(await page.locator("#email").inputValue()).toBe("alex@example.test");
    expect(await page.locator("#city").inputValue()).toBe("Pune");
    // The resume file input itself is never touched by the mapper.
    expect(planned("Resume")).toBe(false);
  });
});
