import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createResumeStore, RESUME_DOCUMENTS_KEY, RESUME_MASTER_KEY, RESUME_VARIANTS_KEY, type ResumeKV } from "@/resume/storage";
import { DEFAULT_RESUME_SETTINGS, RESUME_SETTINGS_KEY, type FileRef, type ResumeDocument, type ResumeVariant } from "@/resume/schema";
import { sampleMaster } from "../../fixtures/resumes";

/** In-memory stand-in for chrome.storage.local. The whole object is inspectable to assert what was written. */
function fakeKv(): ResumeKV & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

const NOW = "2026-02-03T04:05:06.000Z";
const ref = (fileId: string, format: FileRef["format"] = "pdf"): FileRef => ({
  fileId,
  filename: `${fileId}.${format}`,
  mime: format === "pdf" ? "application/pdf" : format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain",
  size: 10,
  format,
  pageValidated: format === "pdf",
  createdAt: NOW,
});

function pseudoPdf(size: number): Uint8Array {
  const out = new Uint8Array(size);
  let s = 123456789;
  for (let i = 0; i < size; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  out.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); // %PDF-
  return out;
}

const variant = (id: string): ResumeVariant => ({
  variantId: id,
  name: `Variant ${id}`,
  roleKeywords: ["data"],
  sectionOrder: ["education", "experience"],
  entryOrder: [],
  pinnedFactIds: [],
  excludedFactIds: [],
  skillGroupOrder: [],
  limits: { maxProjects: 3, maxExperience: 3, maxBulletsPerEntry: 4 },
});

function doc(id: string, output: FileRef | null, docxOutput: FileRef | null): ResumeDocument {
  const hash = "a".repeat(64);
  return {
    documentId: id,
    createdAt: NOW,
    masterId: "m1",
    masterHash: hash,
    variantId: "v1",
    job: { title: "Data Intern", company: "Example Co", url: "https://example.test/job", extract: "extract" },
    tailored: {
      tailoredId: `t_${id}`,
      masterId: "m1",
      masterHash: hash,
      variantId: "v1",
      sections: [
        {
          key: "header",
          title: "Header",
          entries: [{ entryId: "h", lines: [{ lineId: "l1", role: "name", text: "Alex Example", sourceFactIds: ["c_name"], origin: "master", relevance: 0.5, protected: true, onlyEvidenceForRequiredQualification: false }] }],
        },
      ],
      createdAt: NOW,
    },
    report: {
      reportId: `r_${id}`,
      createdAt: NOW,
      masterId: "m1",
      masterHash: hash,
      variantId: "v1",
      variantAutoSelected: true,
      job: { title: "Data Intern", company: "Example Co", url: "https://example.test/job" },
      matchedRequirements: [],
      unmatchedRequirements: [],
      selectedFactIds: [],
      modifiedSections: [],
      rewrites: [],
      droppedLines: [],
      layout: { pageCount: 1, pageLimit: 1, satisfiedLimit: true, warnings: [] },
      validation: null,
      warnings: [],
      output,
      docxOutput,
      coverLetter: null,
      ai: { requests: 0, provider: null },
    },
    validationStatus: "validated",
  };
}

let kv: ReturnType<typeof fakeKv>;
let idb: IDBFactory;
const make = () => createResumeStore({ kv, idb });

beforeEach(() => {
  kv = fakeKv();
  idb = new IDBFactory();
});

describe("resume store: binaries", () => {
  it("stores and reads back a 2 MB PDF-like byte array bit-exactly", async () => {
    const store = make();
    const bytes = pseudoPdf(2 * 1024 * 1024);
    const copy = new Uint8Array(bytes);
    await store.putBinary(ref("f1"), bytes);
    const back = await store.getBinary("f1");
    expect(back).not.toBeNull();
    expect(back!.bytes.byteLength).toBe(bytes.byteLength);
    expect(Buffer.compare(Buffer.from(back!.bytes), Buffer.from(copy))).toBe(0);
    expect(back!.ref.fileId).toBe("f1");
    expect(await store.getBinary("missing")).toBeNull();
  });

  it("a binary never appears in chrome.storage", async () => {
    const store = make();
    const bytes = pseudoPdf(64 * 1024);
    await store.putBinary(ref("f1"), bytes);
    await store.putMaster(sampleMaster());
    await store.putDocument(doc("d1", ref("f1"), null));
    await store.putSettings({ ...DEFAULT_RESUME_SETTINGS, tailoringEnabled: true });
    const serialized = JSON.stringify(kv.data);
    expect(serialized).not.toContain("%PDF");
    expect(Object.keys(kv.data).sort()).toEqual([RESUME_DOCUMENTS_KEY, RESUME_MASTER_KEY, RESUME_SETTINGS_KEY].sort());
    for (const v of Object.values(kv.data)) expect(containsBinary(v)).toBe(false);
    // The size of everything in chrome.storage stays tiny compared with the binary.
    expect(serialized.length).toBeLessThan(bytes.byteLength);
  });

  it("lists binaries and deletes one", async () => {
    const store = make();
    await store.putBinary(ref("a"), new Uint8Array([1, 2, 3]));
    await store.putBinary(ref("b", "docx"), new Uint8Array([4, 5]));
    expect((await store.listBinaries()).map((r) => r.fileId).sort()).toEqual(["a", "b"]);
    await store.deleteBinary("a");
    expect((await store.listBinaries()).map((r) => r.fileId)).toEqual(["b"]);
    expect(await store.getBinary("a")).toBeNull();
  });

  it("copies the caller's bytes (a later mutation does not change what is stored)", async () => {
    const store = make();
    const bytes = new Uint8Array([9, 9, 9]);
    await store.putBinary(ref("a"), bytes);
    bytes[0] = 0;
    expect(Array.from((await store.getBinary("a"))!.bytes)).toEqual([9, 9, 9]);
  });
});

function containsBinary(v: unknown): boolean {
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return true;
  if (Array.isArray(v)) return v.some(containsBinary);
  if (v && typeof v === "object") return Object.values(v).some(containsBinary);
  return false;
}

describe("resume store: documents", () => {
  it("deleteDocument removes the record and both of its binaries, and nothing else", async () => {
    const store = make();
    await store.putBinary(ref("pdf1"), new Uint8Array([1]));
    await store.putBinary(ref("docx1", "docx"), new Uint8Array([2]));
    await store.putBinary(ref("other"), new Uint8Array([3]));
    await store.putDocument(doc("d1", ref("pdf1"), ref("docx1", "docx")));
    await store.putDocument(doc("d2", ref("other"), null));
    expect((await store.listDocuments()).map((d) => d.documentId).sort()).toEqual(["d1", "d2"]);
    await store.deleteDocument("d1");
    expect(await store.getDocument("d1")).toBeNull();
    expect(await store.getBinary("pdf1")).toBeNull();
    expect(await store.getBinary("docx1")).toBeNull();
    expect(await store.getBinary("other")).not.toBeNull();
    expect((await store.getDocument("d2"))?.documentId).toBe("d2");
  });

  it("putDocument replaces a document with the same id", async () => {
    const store = make();
    await store.putDocument(doc("d1", null, null));
    await store.putDocument({ ...doc("d1", null, null), validationStatus: "overflow" });
    const all = await store.listDocuments();
    expect(all).toHaveLength(1);
    expect(all[0]!.validationStatus).toBe("overflow");
  });
});

describe("resume store: master, variants, settings", () => {
  it("round-trips the master and deletes it", async () => {
    const store = make();
    expect(await store.getMaster()).toBeNull();
    const m = sampleMaster();
    await store.putMaster(m);
    expect(await store.getMaster()).toEqual(m);
    await store.deleteMaster();
    expect(await store.getMaster()).toBeNull();
  });

  it("round-trips variants (replace by id, delete by id)", async () => {
    const store = make();
    await Promise.all([store.putVariant(variant("v1")), store.putVariant(variant("v2"))]);
    await store.putVariant({ ...variant("v1"), name: "Renamed" });
    const list = await store.listVariants();
    expect(list.map((v) => v.variantId).sort()).toEqual(["v1", "v2"]);
    expect(list.find((v) => v.variantId === "v1")?.name).toBe("Renamed");
    await store.deleteVariant("v2");
    expect((await store.listVariants()).map((v) => v.variantId)).toEqual(["v1"]);
  });

  it("settings default to tailoring OFF and validate on write", async () => {
    const store = make();
    const s = await store.getSettings();
    expect(s.tailoringEnabled).toBe(false);
    expect(s).toEqual(DEFAULT_RESUME_SETTINGS);
    expect(await store.putSettings({ ...s, tailoringEnabled: true, pageLimit: 2 })).toEqual({ ok: true });
    expect((await store.getSettings()).tailoringEnabled).toBe(true);
    const bad = await store.putSettings({ ...s, pageLimit: 99 });
    expect(bad.ok).toBe(false);
    expect((await store.getSettings()).pageLimit).toBe(2);
  });

  it("uses separate chrome.storage keys per namespace", async () => {
    const store = make();
    await store.putMaster(sampleMaster());
    await store.putVariant(variant("v1"));
    await store.putSettings({ ...DEFAULT_RESUME_SETTINGS });
    expect(Object.keys(kv.data).sort()).toEqual([RESUME_MASTER_KEY, RESUME_SETTINGS_KEY, RESUME_VARIANTS_KEY].sort());
    expect(RESUME_MASTER_KEY).toBe("applypilot.resume.master.v1");
    expect(RESUME_VARIANTS_KEY).toBe("applypilot.resume.variants.v1");
    expect(RESUME_DOCUMENTS_KEY).toBe("applypilot.resume.documents.v1");
  });
});

describe("resume store: corrupt metadata reads as empty and never throws", () => {
  it("master, variants, documents, settings", async () => {
    const store = make();
    kv.data[RESUME_MASTER_KEY] = { schemaVersion: 7, nonsense: true };
    kv.data[RESUME_VARIANTS_KEY] = "not an array";
    kv.data[RESUME_DOCUMENTS_KEY] = [{ documentId: 5 }, null, "x"];
    kv.data[RESUME_SETTINGS_KEY] = { tailoringEnabled: "yes", pageLimit: 1000 };
    expect(await store.getMaster()).toBeNull();
    expect(await store.listVariants()).toEqual([]);
    expect(await store.listDocuments()).toEqual([]);
    expect(await store.getDocument("x")).toBeNull();
    expect(await store.getSettings()).toEqual(DEFAULT_RESUME_SETTINGS);
  });

  it("drops only the invalid items of an otherwise valid list", async () => {
    const store = make();
    kv.data[RESUME_VARIANTS_KEY] = [variant("ok"), { variantId: "bad" }];
    expect((await store.listVariants()).map((v) => v.variantId)).toEqual(["ok"]);
  });
});

describe("resume store: clearAll", () => {
  it("wipes master, variants, documents, binaries and settings", async () => {
    const store = make();
    await store.putMaster(sampleMaster());
    await store.putVariant(variant("v1"));
    await store.putDocument(doc("d1", ref("pdf1"), null));
    await store.putBinary(ref("pdf1"), new Uint8Array([1, 2]));
    await store.putBinary(ref("orphan"), new Uint8Array([3]));
    await store.putSettings({ ...DEFAULT_RESUME_SETTINGS, tailoringEnabled: true });
    await store.clearAll();
    expect(kv.data).toEqual({});
    expect(await store.getMaster()).toBeNull();
    expect(await store.listVariants()).toEqual([]);
    expect(await store.listDocuments()).toEqual([]);
    expect(await store.listBinaries()).toEqual([]);
    expect((await store.getSettings()).tailoringEnabled).toBe(false);
  });

  it("works on a fresh database and with two store instances on the same backends", async () => {
    const a = make();
    await a.putBinary(ref("f1"), new Uint8Array([1]));
    const b = make();
    expect((await b.getBinary("f1"))?.bytes[0]).toBe(1);
    await b.clearAll();
    expect(await a.listBinaries()).toEqual([]);
  });
});
