import type { HandleUploadFn, UploadContext } from "@/resume/contracts";
import type { UploadContentResponse } from "@/resume/messages";
import type { UploadClassification, UploadResult } from "@/resume/schema";
import type { FormField } from "@/shared/form";
import { acceptsFile } from "./accept";
import { classifyFileInputs } from "./classify";
import { awaitRecognition, dispatchDrop, dropTargetFor, scopeOf, snapshot } from "./recognize";
import { kindFromFilename, TransferStore } from "./transfer";

export { classifyFileInput, classifyFileInputs } from "./classify";
export { chooseFileForField } from "./choose";
export { kindFromFilename } from "./transfer";

/**
 * File upload in the content script.
 *
 * Bytes arrive as ordered base64 chunks chosen and driven by the service worker, are reassembled in this script's
 * memory only (module state: never on window, in the DOM, or in event details), become a File via DataTransfer, and
 * are dropped as soon as the transfer ends. The page only ever sees the File on the input it was intended for.
 * Policy lives here too: a resume never goes into a field that is not classified as a resume field, and likewise
 * for cover letters; a field is filled at most once per page session; a field that already holds a file is not touched.
 *
 * Protocol violations (unknown id, bad chunk, size mismatch) answer with the shared error response (code
 * INVALID_MESSAGE) and destroy the transfer; policy refusals answer with an UploadResult of status "skipped".
 */

const store = new TransferStore();
/** Field fingerprints that received a file in this page session. */
const uploaded = new Set<string>();

/** Test hook: forgets all module state. */
export function resetUploadState(): void {
  store.clear();
  uploaded.clear();
}

/** HandleUploadFn's declared return type has no error arm; the shared ErrorResponse is valid at the message layer. */
const fail = (message: string): UploadContentResponse =>
  ({ ok: false, code: "INVALID_MESSAGE", message: message.slice(0, 480) }) as unknown as UploadContentResponse;

function inputOf(ctx: UploadContext, fieldId: string): HTMLInputElement | null {
  const el = ctx.elementsFor(fieldId)?.[0];
  return el && el.tagName === "INPUT" && (el as HTMLInputElement).type === "file" ? (el as HTMLInputElement) : null;
}

function result(
  fieldId: string,
  classification: UploadClassification,
  status: UploadResult["status"],
  reason: string,
  filename: string | null,
  warnings: string[] = [],
): UploadContentResponse {
  return { ok: true, kind: "UPLOADED", result: { fieldId, status, classification, reason: reason.slice(0, 300), fileId: null, filename, warnings } };
}

function list(ctx: UploadContext): UploadContentResponse {
  const cls = classifyFileInputs(ctx.fields);
  // A new listing starts a new upload phase: a field whose input is empty again (the user removed the file, or the page
  // reset it) may receive a file in a later run. The run-level record in the service worker is what stops duplicates.
  for (const f of ctx.fields) if (f.control === "file" && (inputOf(ctx, f.fieldId)?.files?.length ?? 0) === 0) uploaded.delete(f.fingerprint);
  const fields = ctx.fields
    .filter((f) => f.control === "file")
    .slice(0, 20)
    .map((f) => {
      const c = cls.get(f.fieldId)!;
      return {
        fieldId: f.fieldId,
        classification: c.classification,
        accept: f.accept.slice(0, 300),
        label: f.label.slice(0, 200),
        required: f.required,
        reason: c.reason.slice(0, 200),
        hasFile: (inputOf(ctx, f.fieldId)?.files?.length ?? 0) > 0,
      };
    });
  return { ok: true, kind: "UPLOAD_FIELDS", fields };
}

async function commit(transferId: string, ctx: UploadContext): Promise<UploadContentResponse> {
  const done = store.commit(transferId);
  if (!done.ok) return fail(done.message);
  const { meta, bytes } = done;
  try {
    return await place(meta.fieldId, meta.filename, meta.mime, bytes, ctx);
  } finally {
    bytes.fill(0);
  }
}

async function place(fieldId: string, filename: string, mime: string, bytes: Uint8Array, ctx: UploadContext): Promise<UploadContentResponse> {
  const field: FormField | undefined = ctx.fields.find((f) => f.fieldId === fieldId);
  const input = field ? inputOf(ctx, fieldId) : null;
  if (!field || !input || !input.isConnected) return result(fieldId, "ambiguous", "skipped", "The file input is no longer on the page", filename);

  const info = classifyFileInputs(ctx.fields).get(fieldId) ?? { classification: "ambiguous" as const, reason: "" };
  const cls = info.classification;
  const skip = (reason: string) => result(fieldId, cls, "skipped", reason, filename);

  const kind = kindFromFilename(filename);
  if (!kind) return skip("The file's role (resume or cover letter) cannot be told from its name; not uploaded");
  if (cls !== "resume" && cls !== "cover_letter") return skip(`Field is classified "${cls}" (${info.reason}); a ${kind.replace("_", " ")} is never placed in it`);
  if (cls !== kind) return skip(`Field is a ${cls.replace("_", " ")} field; a ${kind.replace("_", " ")} is never placed in it`);
  if (uploaded.has(field.fingerprint)) return skip("already uploaded this run");
  if ((input.files?.length ?? 0) > 0) return skip("The field already holds a file; not replaced");
  if (input.disabled) return skip("The file input is disabled");
  if (!acceptsFile(input.getAttribute("accept") ?? "", filename, mime)) return skip(`The field accepts "${input.getAttribute("accept")}", which this file does not satisfy`);

  const view = input.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!view || typeof view.DataTransfer === "undefined") return result(fieldId, cls, "failed", "This browser context cannot build a file list", filename);

  const warnings: string[] = [];
  if (/\.docx$/i.test(filename)) warnings.push("DOCX is not page-validated");

  const file = new view.File([bytes as BlobPart], filename, { type: mime, lastModified: Date.now() });
  const before = snapshot(scopeOf(input));

  // Marked before the first await so a concurrent second commit cannot slip in.
  uploaded.add(field.fingerprint);
  const dt = new view.DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  if (input.files?.length !== 1) return result(fieldId, cls, "failed", "The browser did not attach the file to the input", filename, warnings);
  input.dispatchEvent(new view.Event("input", { bubbles: true }));
  input.dispatchEvent(new view.Event("change", { bubbles: true }));

  let r = await awaitRecognition(input, filename, before);
  if (r.state === "error") return result(fieldId, cls, "failed", `The page reported an error: ${r.detail}`, filename, warnings);
  if (r.state === "recognized") return result(fieldId, cls, "uploaded_verified", r.detail, filename, warnings);

  // The page ignored the input events. Same-document drop zone only; one attempt, no retry.
  if (dispatchDrop(dropTargetFor(input), file)) {
    r = await awaitRecognition(input, filename, before);
    if (r.state === "error") return result(fieldId, cls, "failed", `The page reported an error: ${r.detail}`, filename, warnings);
    if (r.state === "recognized") return result(fieldId, cls, "uploaded_verified", `${r.detail} (after a drop on the upload area)`, filename, warnings);
  }
  return result(fieldId, cls, "uploaded_unrecognized", "upload not recognized", filename, warnings);
}

export const handleUpload: HandleUploadFn = async (req, ctx) => {
  switch (req.kind) {
    case "UPLOAD_LIST":
      return list(ctx);
    case "UPLOAD_BEGIN": {
      const field = ctx.fields.find((f) => f.fieldId === req.fieldId);
      if (!field || field.control !== "file" || !inputOf(ctx, req.fieldId)) return fail("Unknown file field");
      const r = store.begin({ transferId: req.transferId, fieldId: req.fieldId, filename: req.filename, mime: req.mime, size: req.size, chunkCount: req.chunkCount });
      return r.ok ? { ok: true, kind: "UPLOAD_ACK", transferId: req.transferId, received: 0 } : fail(r.message);
    }
    case "UPLOAD_CHUNK": {
      const r = store.chunk(req.transferId, req.index, req.dataB64);
      return r.ok ? { ok: true, kind: "UPLOAD_ACK", transferId: req.transferId, received: r.received } : fail(r.message);
    }
    case "UPLOAD_COMMIT":
      return commit(req.transferId, ctx);
    case "UPLOAD_ABORT":
      return { ok: true, kind: "UPLOAD_ACK", transferId: req.transferId, received: store.abort(req.transferId) };
  }
};
