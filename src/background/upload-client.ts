import { UPLOAD_CHUNK_BYTES, UPLOAD_MAX_CHUNKS } from "@/resume/messages";
import type { FileRef, UploadResult } from "@/resume/schema";
import type { ContentRequest, ContentResponse } from "@/shared/messages";

/**
 * Sends one stored file to one file input of the page, in base64 chunks over the extension message channel (SPEC 12.7).
 * The bytes never touch a URL the page could fetch. The content script validates every chunk and answers with the final
 * UploadResult; this side only moves bytes and reports exactly what the page said.
 */

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const step = 0x2000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

export type TransferArgs = {
  send(req: ContentRequest): Promise<ContentResponse>;
  fieldId: string;
  file: { ref: FileRef; bytes: Uint8Array };
  /** The run is still active; a stopped run must not keep sending. */
  isActive(): boolean;
  newId(): string;
};

const failed = (fieldId: string, reason: string, filename: string | null): UploadResult => ({
  fieldId,
  status: "failed",
  classification: "ambiguous",
  reason: reason.slice(0, 300),
  fileId: null,
  filename,
  warnings: [],
});

export async function transferFile(a: TransferArgs): Promise<UploadResult> {
  const { bytes, ref } = a.file;
  const chunkCount = Math.max(1, Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES));
  if (chunkCount > UPLOAD_MAX_CHUNKS) return failed(a.fieldId, "File is too large to send to the page", ref.filename);
  const transferId = a.newId();
  const abort = () => a.send({ kind: "UPLOAD_ABORT", transferId }).catch(() => undefined);
  try {
    const begin = await a.send({ kind: "UPLOAD_BEGIN", transferId, fieldId: a.fieldId, filename: ref.filename, mime: ref.mime, size: bytes.length, chunkCount });
    if (!begin.ok) return failed(a.fieldId, begin.message, ref.filename);
    for (let i = 0; i < chunkCount; i++) {
      if (!a.isActive()) {
        await abort();
        return failed(a.fieldId, "Stopped before the upload finished", ref.filename);
      }
      const dataB64 = toBase64(bytes.subarray(i * UPLOAD_CHUNK_BYTES, (i + 1) * UPLOAD_CHUNK_BYTES));
      const ack = await a.send({ kind: "UPLOAD_CHUNK", transferId, index: i, dataB64 });
      if (!ack.ok) {
        await abort();
        return failed(a.fieldId, ack.message, ref.filename);
      }
    }
    const done = await a.send({ kind: "UPLOAD_COMMIT", transferId });
    if (!done.ok) return failed(a.fieldId, done.message, ref.filename);
    if (done.kind !== "UPLOADED") return failed(a.fieldId, "Unexpected reply from the page", ref.filename);
    return done.result;
  } catch (e) {
    await abort();
    return failed(a.fieldId, e instanceof Error ? e.message : "Upload failed", ref.filename);
  }
}
