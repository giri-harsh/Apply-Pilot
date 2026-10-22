import { UPLOAD_CHUNK_BYTES } from "@/resume/messages";
import type { FileKind } from "./classify";

/**
 * File role convention. The service worker names every file it hands over, and the role is derived from that name,
 * never from anything the page says: resumes are `*_Resume_*` (for example `Alex_Resume_Acme.pdf`), cover letters are
 * `*_CoverLetter_*`. The match is case-insensitive and the role word must be a whole underscore-delimited part (or the
 * last part before the extension). A name that matches both, or neither, has no role and is never uploaded.
 */
export function kindFromFilename(filename: string): FileKind | null {
  const resume = /(?:^|_)resume(?:_|\.[a-z0-9]{1,8}$)/i.test(filename);
  const cover = /(?:^|_)coverletter(?:_|\.[a-z0-9]{1,8}$)/i.test(filename);
  if (resume === cover) return null;
  return resume ? "resume" : "cover_letter";
}

export type TransferMeta = { transferId: string; fieldId: string; filename: string; mime: string; size: number; chunkCount: number };
type Transfer = TransferMeta & { chunks: Uint8Array[]; received: number; bytes: number; timer: ReturnType<typeof setTimeout> | null };

export type Fail = { ok: false; message: string };
export type Completed = { ok: true; meta: TransferMeta; bytes: Uint8Array };

export const TRANSFER_TTL_MS = 60_000;
const MAX_IN_FLIGHT = 4;

/**
 * In-flight transfers, held only in the content script's memory (module state, never on window, the DOM or events).
 * Any protocol violation destroys the transfer it concerns. Buffers are zeroed when a transfer ends and freed after a
 * timeout if the sender goes quiet.
 */
export class TransferStore {
  private transfers = new Map<string, Transfer>();
  constructor(private ttlMs = TRANSFER_TTL_MS) {}

  get size(): number {
    return this.transfers.size;
  }

  begin(meta: TransferMeta): Fail | { ok: true } {
    if (this.transfers.has(meta.transferId)) return { ok: false, message: "Transfer id already in use" };
    for (const t of this.transfers.values()) if (t.fieldId === meta.fieldId) return { ok: false, message: "A transfer for this field is already in flight" };
    if (this.transfers.size >= MAX_IN_FLIGHT) return { ok: false, message: "Too many transfers in flight" };
    if (meta.chunkCount < Math.ceil(meta.size / UPLOAD_CHUNK_BYTES)) return { ok: false, message: "Declared chunk count cannot hold the declared size" };
    if (meta.chunkCount > meta.size) return { ok: false, message: "Declared chunk count exceeds the declared size" };
    const t: Transfer = { ...meta, chunks: [], received: 0, bytes: 0, timer: null };
    t.timer = setTimeout(() => this.drop(meta.transferId), this.ttlMs);
    this.transfers.set(meta.transferId, t);
    return { ok: true };
  }

  chunk(transferId: string, index: number, dataB64: string): Fail | { ok: true; received: number } {
    const t = this.transfers.get(transferId);
    if (!t) return { ok: false, message: "Unknown transfer id" };
    if (index !== t.received) {
      this.drop(transferId);
      return { ok: false, message: index < t.received ? "Duplicate chunk; transfer discarded" : "Out-of-order chunk; transfer discarded" };
    }
    if (index >= t.chunkCount) {
      this.drop(transferId);
      return { ok: false, message: "More chunks than declared; transfer discarded" };
    }
    let data: Uint8Array;
    try {
      const bin = atob(dataB64);
      data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    } catch {
      this.drop(transferId);
      return { ok: false, message: "Chunk is not valid base64; transfer discarded" };
    }
    if (data.length === 0 || data.length > UPLOAD_CHUNK_BYTES || t.bytes + data.length > t.size) {
      this.drop(transferId);
      return { ok: false, message: "Chunk size out of bounds or beyond the declared size; transfer discarded" };
    }
    t.chunks.push(data);
    t.received += 1;
    t.bytes += data.length;
    return { ok: true, received: t.received };
  }

  /** Verifies count and total size, hands over the reassembled bytes and forgets the transfer. */
  commit(transferId: string): Fail | Completed {
    const t = this.transfers.get(transferId);
    if (!t) return { ok: false, message: "Unknown transfer id" };
    if (t.received !== t.chunkCount) {
      this.drop(transferId);
      return { ok: false, message: `Expected ${t.chunkCount} chunks but received ${t.received}; transfer discarded` };
    }
    if (t.bytes !== t.size) {
      this.drop(transferId);
      return { ok: false, message: `Declared ${t.size} bytes but received ${t.bytes}; transfer discarded` };
    }
    const out = new Uint8Array(t.size);
    let at = 0;
    for (const c of t.chunks) {
      out.set(c, at);
      at += c.length;
    }
    const meta: TransferMeta = { transferId: t.transferId, fieldId: t.fieldId, filename: t.filename, mime: t.mime, size: t.size, chunkCount: t.chunkCount };
    this.drop(transferId);
    return { ok: true, meta, bytes: out };
  }

  abort(transferId: string): number {
    const t = this.transfers.get(transferId);
    this.drop(transferId);
    return t ? t.received : 0;
  }

  private drop(transferId: string): void {
    const t = this.transfers.get(transferId);
    if (!t) return;
    if (t.timer) clearTimeout(t.timer);
    for (const c of t.chunks) c.fill(0);
    t.chunks = [];
    this.transfers.delete(transferId);
  }

  clear(): void {
    for (const id of [...this.transfers.keys()]) this.drop(id);
  }
}
