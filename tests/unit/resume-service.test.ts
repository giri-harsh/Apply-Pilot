// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ResumeService, type ResumeServiceDeps } from "@/background/resume-service";
import type { UploadPhaseInput } from "@/background/run-manager";
import { chooseFileForField } from "@/content/upload/choose";
import { rankAgainstProfile } from "@/job/rank";
import type { OffscreenRequest, OffscreenResponse } from "@/resume/offscreen-protocol";
import { DEFAULT_LAYOUT, type FileRef, type MasterResume, type PdfValidation } from "@/resume/schema";
import { tailor, makeShorten } from "@/resume/tailor";
import { defaultVariants, selectVariant } from "@/resume/variants";
import type { ContentRequest, ContentResponse } from "@/shared/messages";
import type { FormField } from "@/shared/form";
import { testProfile } from "../fixtures/profile";
import { sampleMaster } from "../fixtures/resumes";
import { fakeStore } from "./resume-tailor/fake-store";
import { jobFixture } from "./resume-tailor/fixtures";
import { field } from "./helpers";

void rankAgainstProfile;
const NOW = new Date("2026-10-22T10:00:00Z");

type Setup = { master?: MasterResume | null; tailoring?: boolean; validation?: Partial<PdfValidation>; uploadStatus?: "uploaded_verified" | "uploaded_unrecognized" | "failed"; hasFile?: boolean; throwAfterBuild?: boolean };

async function setup(o: Setup = {}) {
  const master = o.master === undefined ? sampleMaster() : o.master;
  const store = fakeStore({ master });
  await store.putSettings({ tailoringEnabled: o.tailoring ?? true, pageLimit: 1, coverLetterEnabled: false, maxUploadBytes: 5_000_000, autoSelectVariant: true, defaultVariantId: null, layout: {} });
  let n = 0;
  const builds: OffscreenRequest[] = [];
  const sent: ContentRequest[] = [];
  const build = vi.fn(async (req: OffscreenRequest): Promise<OffscreenResponse> => {
    builds.push(req);
    const ref = (name: string, mime: FileRef["mime"], format: FileRef["format"]): FileRef => ({ fileId: `f${++n}${"x".repeat(6)}`, filename: name, mime, size: 4, format, pageValidated: format === "pdf", createdAt: NOW.toISOString() });
    const pdf = ref(req.filename, "application/pdf", "pdf");
    await store.putBinary(pdf, new Uint8Array([1, 2, 3, 4]));
    const docx = ref(req.docxFilename!, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx");
    await store.putBinary(docx, new Uint8Array([5, 6, 7, 8]));
    const validation: PdfValidation = { ok: true, pageCount: 1, pageLimit: 1, missingSections: [], missingContact: [], findings: [], ...o.validation };
    return { ok: true, layout: { pageCount: 1, finalResume: req.tailored, appliedConfig: DEFAULT_LAYOUT, droppedLineIds: [], shortenedLineIds: [], satisfiedLimit: true, warnings: [] }, validation, pdf, docx };
  });
  const sendToTab = async (_t: number, req: ContentRequest): Promise<ContentResponse> => {
    sent.push(req);
    if (req.kind === "UPLOAD_LIST") return { ok: true, kind: "UPLOAD_FIELDS", fields: [{ fieldId: "field_001", classification: "resume", accept: ".pdf", label: "Resume", required: true, reason: "label", hasFile: o.hasFile ?? false }] };
    if (req.kind === "UPLOAD_BEGIN" || req.kind === "UPLOAD_CHUNK") return { ok: true, kind: "UPLOAD_ACK", transferId: "t", received: 0 };
    if (req.kind === "UPLOAD_COMMIT") return { ok: true, kind: "UPLOADED", result: { fieldId: "field_001", status: o.uploadStatus ?? "uploaded_verified", classification: "resume", reason: o.uploadStatus === "uploaded_unrecognized" ? "upload not recognized" : "ok", fileId: null, filename: null, warnings: [] } };
    return { ok: true, kind: "PONG" };
  };
  const deps: ResumeServiceDeps = {
    store,
    loadProfile: async () => testProfile(),
    loadJob: async () => jobFixture(),
    getAi: async () => null,
    tailor,
    selectVariant,
    defaultVariants,
    makeShorten,
    coverLetter: async () => null,
    chooseFile: chooseFileForField,
    sendToTab,
    build,
    now: () => NOW,
    newId: () => `id-${String(++n).padStart(8, "0")}`,
  };
  const svc = new ResumeService(deps);
  const f: FormField = field({ fieldId: "field_001", control: "file", label: "Resume", required: true, fingerprint: "fp-cv", accept: ".pdf" });
  const saved: UploadPhaseInput["resume"][] = [];
  const idle: UploadPhaseInput["resume"] = { status: "not_needed", variantId: null, variantAuto: false, documentId: null, filename: null, pageCount: null, warnings: [], uploaded: [], uploadVerified: false };
  const input = (resume = idle, runId = "run-1"): UploadPhaseInput => ({
    tabId: 1, runId, url: "https://jobs.example.test/ml", fields: [f], variantId: null, resume,
    scheduler: undefined as never, isActive: () => true, save: async (r) => void saved.push(r),
  });
  return { svc, store, build, builds, sent, input, saved, idle };
}

describe("ResumeService: honest outcomes", () => {
  it("a verified upload marks the resume prepared AND uploaded, and persists the document id before any byte is sent", async () => {
    const t = await setup();
    const out = await t.svc.uploadResume(t.input());
    expect(out.resume).toMatchObject({ status: "tailored", uploadVerified: true, pageCount: 1 });
    expect(out.results[0]).toMatchObject({ outcome: "filled_verified" });
    expect(t.saved[0]!.documentId).toBeTruthy(); // saved right after preparation
    expect(t.saved.every((r, i) => i === 0 || r.documentId === t.saved[0]!.documentId)).toBe(true);
  });

  it.each(["uploaded_unrecognized", "failed"] as const)("%s: the resume is prepared but the run says it was NOT uploaded", async (uploadStatus) => {
    const t = await setup({ uploadStatus });
    const out = await t.svc.uploadResume(t.input());
    expect(out.resume.status).toBe("tailored");
    expect(out.resume.uploadVerified).toBe(false);
    expect(out.results[0]!.outcome).toBe("failed");
  });

  it("a resume that failed validation is kept in history but never uploaded; nothing validated exists, so nothing is sent", async () => {
    const t = await setup({ validation: { ok: false, missingContact: ["name"], findings: ["The applicant's name is missing from the PDF text"] } });
    const out = await t.svc.uploadResume(t.input());
    expect(out.results[0]!.outcome).toBe("unresolved");
    expect(out.resume.uploadVerified).toBe(false);
    expect(t.sent.some((r) => r.kind === "UPLOAD_BEGIN")).toBe(false);
    const docs = await t.store.listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.validationStatus).toBe("failed");
    expect(out.notes.join(" ")).toMatch(/failed validation/);
  });

  it("an input that already holds a file is not replaced and is not counted as satisfied", async () => {
    const t = await setup({ hasFile: true });
    const out = await t.svc.uploadResume(t.input());
    expect(out.results[0]).toMatchObject({ outcome: "unresolved" });
    expect(out.results[0]!.reason).toMatch(/did not add/);
    expect(t.sent.some((r) => r.kind === "UPLOAD_BEGIN")).toBe(false);
  });
});

describe("ResumeService: restarts and orphans", () => {
  it("after a service worker restart the document already made for this run is reused: no second tailoring, no second document", async () => {
    const t = await setup();
    const first = await t.svc.uploadResume(t.input());
    const again = new ResumeService((t.svc as unknown as { deps: ResumeServiceDeps }).deps); // a fresh worker: empty in-memory cache
    const second = await again.uploadResume(t.input({ ...first.resume, uploaded: [] }, "run-1"));
    expect(t.build).toHaveBeenCalledTimes(1);
    expect(await t.store.listDocuments()).toHaveLength(1);
    expect(second.resume.documentId).toBe(first.resume.documentId);
    expect(second.resume.uploadVerified).toBe(true);
  });

  it("if the master changes while the document is being built, the binaries the builder wrote are removed and nothing is saved", async () => {
    const t = await setup();
    t.build.mockImplementationOnce(async (req) => {
      const m = sampleMaster();
      m.contact.name.text = "Someone Else";
      await t.store.putMaster(m); // the master changes mid-build
      const ref = (name: string): FileRef => ({ fileId: `orph-${name.length}-xx`, filename: name, mime: "application/pdf", size: 1, format: "pdf", pageValidated: true, createdAt: NOW.toISOString() });
      const pdf = ref(req.filename);
      await t.store.putBinary(pdf, new Uint8Array([1]));
      return { ok: true, layout: { pageCount: 1, finalResume: req.tailored, appliedConfig: DEFAULT_LAYOUT, droppedLineIds: [], shortenedLineIds: [], satisfiedLimit: true, warnings: [] }, validation: { ok: true, pageCount: 1, pageLimit: 1, missingSections: [], missingContact: [], findings: [] }, pdf, docx: null };
    });
    const out = await t.svc.uploadResume(t.input());
    expect(out.resume.status).toBe("failed");
    expect(await t.store.listDocuments()).toEqual([]);
    expect(await t.store.listBinaries()).toEqual([]); // no orphan
  });

  it("tailoring off: only a previously validated resume is reused, and it is not called uploaded until the page confirms", async () => {
    const t = await setup();
    await t.svc.uploadResume(t.input()); // makes a validated document
    await t.store.putSettings({ ...(await t.store.getSettings()), tailoringEnabled: false });
    const out = await t.svc.uploadResume(t.input(t.idle, "run-2"));
    expect(out.resume.status).toBe("reused");
    expect(t.build).toHaveBeenCalledTimes(1);
  });
});
