import { PortalCaptureSchema, type PortalCapture } from "./schema";

/**
 * Captures live in IndexedDB under a diagnostics namespace of their own (SPEC 20.2): never in chrome.storage, never mixed
 * with the profile, runs or AI data. Listing returns summaries; viewing, exporting and deleting are explicit user actions.
 */

export const DIAG_DB = "applypilot-diagnostics";
const STORE = "captures";
export const MAX_CAPTURES = 100;

export type CaptureSummary = { captureId: string; capturedAt: string; host: string; path: string; title: string; step: number | null; fields: number; controls: number };

export interface CaptureStore {
  put(c: PortalCapture): Promise<void>;
  list(): Promise<CaptureSummary[]>;
  get(id: string): Promise<PortalCapture | null>;
  delete(id: string): Promise<void>;
  clearAll(): Promise<void>;
  exportAll(): Promise<PortalCapture[]>;
}

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))));

export function createCaptureStore(deps: { idb?: IDBFactory; dbName?: string } = {}): CaptureStore {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      // Version 2: a database left at version 1 without the object store (an inspector that opened it first) is repaired.
      const open = (deps.idb ?? indexedDB).open(deps.dbName ?? DIAG_DB, 2);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: "captureId" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    }));
  const all = async (): Promise<PortalCapture[]> => {
    const rows = (await req((await db()).transaction(STORE, "readonly").objectStore(STORE).getAll())) as unknown[];
    return rows.flatMap((r) => {
      const p = PortalCaptureSchema.safeParse(r);
      return p.success ? [p.data] : []; // an entry that no longer validates is ignored, never shown
    });
  };
  return {
    async put(c) {
      const valid = PortalCaptureSchema.parse(c);
      const tx = (await db()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(valid);
      await done(tx);
      // keep the namespace bounded: the oldest captures go first
      const rows = (await all()).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
      for (const old of rows.slice(0, Math.max(0, rows.length - MAX_CAPTURES))) await this.delete(old.captureId);
    },
    async list() {
      return (await all())
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        .map((c) => ({ captureId: c.captureId, capturedAt: c.capturedAt, host: c.page.host, path: c.page.path, title: c.page.title, step: c.step, fields: c.fields.length, controls: c.controls.length }));
    },
    async get(id) {
      const r = await req((await db()).transaction(STORE, "readonly").objectStore(STORE).get(id));
      const p = PortalCaptureSchema.safeParse(r);
      return p.success ? p.data : null;
    },
    async delete(id) {
      const tx = (await db()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      await done(tx);
    },
    async clearAll() {
      const tx = (await db()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      await done(tx);
    },
    exportAll: all,
  };
}
