import type { ResumeStore } from "@/resume/contracts";
import { DEFAULT_RESUME_SETTINGS, ResumeSettingsSchema, type FileRef, type MasterResume, type ResumeDocument, type ResumeSettings, type ResumeVariant } from "@/resume/schema";

/** In-memory ResumeStore for tests (B1 implements the real one). Values are cloned on the way in and out. */
export function fakeStore(initial: { master?: MasterResume | null; variants?: ResumeVariant[] } = {}): ResumeStore {
  let master: MasterResume | null = initial.master ? structuredClone(initial.master) : null;
  const variants = new Map<string, ResumeVariant>((initial.variants ?? []).map((v) => [v.variantId, structuredClone(v)]));
  const docs = new Map<string, ResumeDocument>();
  const bins = new Map<string, { ref: FileRef; bytes: Uint8Array }>();
  let settings: ResumeSettings = DEFAULT_RESUME_SETTINGS;
  return {
    async putBinary(ref, bytes) { bins.set(ref.fileId, { ref, bytes }); },
    async getBinary(id) { return bins.get(id) ?? null; },
    async deleteBinary(id) { bins.delete(id); },
    async listBinaries() { return [...bins.values()].map((b) => b.ref); },
    async getMaster() { return master ? structuredClone(master) : null; },
    async putMaster(m) { master = structuredClone(m); },
    async deleteMaster() { master = null; },
    async listVariants() { return [...variants.values()].map((v) => structuredClone(v)); },
    async putVariant(v) { variants.set(v.variantId, structuredClone(v)); },
    async deleteVariant(id) { variants.delete(id); },
    async getSettings() { return settings; },
    async putSettings(s) {
      const r = ResumeSettingsSchema.safeParse(s);
      if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Invalid" };
      settings = r.data;
      return { ok: true };
    },
    async putDocument(d) { docs.set(d.documentId, d); },
    async getDocument(id) { return docs.get(id) ?? null; },
    async listDocuments() { return [...docs.values()]; },
    async deleteDocument(id) { docs.delete(id); },
    async clearAll() { master = null; variants.clear(); docs.clear(); bins.clear(); settings = DEFAULT_RESUME_SETTINGS; },
  };
}
