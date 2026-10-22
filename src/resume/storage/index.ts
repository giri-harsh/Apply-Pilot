import { z } from "zod";
import type { ResumeStore } from "../contracts";
import {
  DEFAULT_RESUME_SETTINGS,
  FileRefSchema,
  MasterResumeSchema,
  RESUME_SETTINGS_KEY,
  ResumeDocumentSchema,
  ResumeSettingsSchema,
  ResumeVariantSchema,
  type FileRef,
  type ResumeDocument,
  type ResumeVariant,
} from "../schema";

/** Minimal slice of chrome.storage.local so the store is unit-testable. */
export interface ResumeKV {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const chromeResumeKV = (): ResumeKV => ({
  get: (k) => chrome.storage.local.get(k),
  set: (i) => chrome.storage.local.set(i),
  remove: (k) => chrome.storage.local.remove(k),
});

// Separate namespaces (SPEC 20.2). Binaries are never stored here.
export const RESUME_MASTER_KEY = "applypilot.resume.master.v1";
export const RESUME_VARIANTS_KEY = "applypilot.resume.variants.v1";
export const RESUME_DOCUMENTS_KEY = "applypilot.resume.documents.v1";
export const RESUME_DB_NAME = "applypilot-resume";
const FILES = "files";

export type ResumeStoreDeps = { kv?: ResumeKV; idb?: IDBFactory; dbName?: string };

type FileRecord = { fileId: string; ref: FileRef; bytes: Uint8Array };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Parses an array value item by item: invalid items are dropped, a non-array reads as empty. Never throws. */
function parseList<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function createResumeStore(deps: ResumeStoreDeps = {}): ResumeStore {
  const kv = deps.kv ?? chromeResumeKV();
  const dbName = deps.dbName ?? RESUME_DB_NAME;
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDb = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      const factory = deps.idb ?? indexedDB;
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const open = factory.open(dbName, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(FILES)) open.result.createObjectStore(FILES, { keyPath: "fileId" });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error("Could not open IndexedDB"));
      }).catch((e) => {
        dbPromise = null;
        throw e;
      });
    }
    return dbPromise;
  };

  // Serialise read-modify-write of the array namespaces within this store instance.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const readRaw = async (key: string): Promise<unknown> => (await kv.get(key))[key];

  const readVariants = async (): Promise<ResumeVariant[]> => parseList(ResumeVariantSchema, await readRaw(RESUME_VARIANTS_KEY));
  const readDocuments = async (): Promise<ResumeDocument[]> => parseList(ResumeDocumentSchema, await readRaw(RESUME_DOCUMENTS_KEY));

  const readFile = async (fileId: string): Promise<{ ref: FileRef; bytes: Uint8Array } | null> => {
    const db = await openDb();
    const rec = (await req(db.transaction(FILES, "readonly").objectStore(FILES).get(fileId))) as Partial<FileRecord> | undefined;
    if (!rec) return null;
    const ref = FileRefSchema.safeParse(rec.ref);
    if (!ref.success || !rec.bytes) return null;
    return { ref: ref.data, bytes: new Uint8Array(rec.bytes) };
  };

  const deleteFile = async (fileId: string): Promise<void> => {
    const db = await openDb();
    const tx = db.transaction(FILES, "readwrite");
    tx.objectStore(FILES).delete(fileId);
    await done(tx);
  };

  return {
    async putBinary(ref, bytes) {
      const valid = FileRefSchema.parse(ref);
      const db = await openDb();
      const tx = db.transaction(FILES, "readwrite");
      const record: FileRecord = { fileId: valid.fileId, ref: valid, bytes: new Uint8Array(bytes) }; // copy: caller's buffer stays theirs
      tx.objectStore(FILES).put(record);
      await done(tx);
    },
    getBinary: readFile,
    deleteBinary: deleteFile,
    async listBinaries() {
      const db = await openDb();
      const all = (await req(db.transaction(FILES, "readonly").objectStore(FILES).getAll())) as Partial<FileRecord>[];
      const refs: FileRef[] = [];
      for (const rec of all) {
        const r = FileRefSchema.safeParse(rec.ref);
        if (r.success) refs.push(r.data);
      }
      return refs;
    },

    async getMaster() {
      const r = MasterResumeSchema.safeParse(await readRaw(RESUME_MASTER_KEY));
      return r.success ? r.data : null;
    },
    async putMaster(master) {
      await kv.set({ [RESUME_MASTER_KEY]: MasterResumeSchema.parse(master) });
    },
    async deleteMaster() {
      await kv.remove(RESUME_MASTER_KEY);
    },

    listVariants: readVariants,
    putVariant: (variant) =>
      exclusive(async () => {
        const v = ResumeVariantSchema.parse(variant);
        const list = (await readVariants()).filter((x) => x.variantId !== v.variantId);
        list.push(v);
        await kv.set({ [RESUME_VARIANTS_KEY]: list });
      }),
    deleteVariant: (variantId) =>
      exclusive(async () => {
        await kv.set({ [RESUME_VARIANTS_KEY]: (await readVariants()).filter((x) => x.variantId !== variantId) });
      }),

    async getSettings() {
      const r = ResumeSettingsSchema.safeParse(await readRaw(RESUME_SETTINGS_KEY));
      return r.success ? r.data : DEFAULT_RESUME_SETTINGS;
    },
    async putSettings(settings) {
      const r = ResumeSettingsSchema.safeParse(settings);
      if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Invalid settings" };
      await kv.set({ [RESUME_SETTINGS_KEY]: r.data });
      return { ok: true };
    },

    putDocument: (doc) =>
      exclusive(async () => {
        const d = ResumeDocumentSchema.parse(doc);
        const list = (await readDocuments()).filter((x) => x.documentId !== d.documentId);
        list.push(d);
        await kv.set({ [RESUME_DOCUMENTS_KEY]: list });
      }),
    async getDocument(documentId) {
      return (await readDocuments()).find((d) => d.documentId === documentId) ?? null;
    },
    listDocuments: readDocuments,
    deleteDocument: (documentId) =>
      exclusive(async () => {
        const list = await readDocuments();
        const doc = list.find((d) => d.documentId === documentId);
        if (doc) {
          for (const ref of [doc.report.output, doc.report.docxOutput, doc.report.coverLetter]) if (ref) await deleteFile(ref.fileId);
        }
        await kv.set({ [RESUME_DOCUMENTS_KEY]: list.filter((d) => d.documentId !== documentId) });
      }),

    clearAll: () =>
      exclusive(async () => {
        await kv.remove([RESUME_MASTER_KEY, RESUME_VARIANTS_KEY, RESUME_DOCUMENTS_KEY, RESUME_SETTINGS_KEY]);
        const db = await openDb();
        const tx = db.transaction(FILES, "readwrite");
        tx.objectStore(FILES).clear();
        await done(tx);
      }),
  };
}
