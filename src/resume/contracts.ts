import type { AIConfig } from "@/ai/config";
import type { RouterDeps } from "@/ai/router";
import type { KVStore } from "@/ai/storage";
import type { AIProvider } from "@/ai/types";
import type { FormField } from "@/shared/form";
import type { ErrorResponse } from "@/shared/messages";
import type { UserProfile } from "@/shared/profile";
import type { JobContext, MatchReport } from "@/job/schema";
import type {
  FileRef,
  LayoutConfig,
  LayoutResult,
  MasterResume,
  ParsedResume,
  PdfValidation,
  ResumeDocument,
  ResumeSettings,
  ResumeTailoringReport,
  ResumeVariant,
  TailoredLine,
  TailoredResume,
  UploadClassification,
  UploadResult,
} from "./schema";
import type { UploadContentRequest, UploadContentResponse } from "./messages";

/**
 * Phase 7 function and interface contracts. LEAD-owned. Each builder implements the stub module named next to the
 * signature; the stubs throw "not implemented" until then. Types only live here so builders cannot drift apart.
 */

// ------------------------------------------------------------------ B1: src/resume/storage + src/resume/import

/**
 * Binaries (resume files, generated PDF / DOCX) live in IndexedDB in the extension origin; metadata lives in
 * chrome.storage.local under separate namespaces (SPEC 20.2). Everything here is user-deletable (SPEC 19.4).
 * Binaries are NEVER written to chrome.storage.
 */
export interface ResumeStore {
  putBinary(ref: FileRef, bytes: Uint8Array): Promise<void>;
  getBinary(fileId: string): Promise<{ ref: FileRef; bytes: Uint8Array } | null>;
  deleteBinary(fileId: string): Promise<void>;
  listBinaries(): Promise<FileRef[]>;

  getMaster(): Promise<MasterResume | null>;
  /** Replaces the master. Only the confirm flow and explicit user edits may call this; tailoring never does. */
  putMaster(master: MasterResume): Promise<void>;
  deleteMaster(): Promise<void>;

  listVariants(): Promise<ResumeVariant[]>;
  putVariant(variant: ResumeVariant): Promise<void>;
  deleteVariant(variantId: string): Promise<void>;

  getSettings(): Promise<ResumeSettings>;
  putSettings(settings: ResumeSettings): Promise<{ ok: true } | { ok: false; message: string }>;

  /** History of generated documents with their reports (SPEC 7.7). */
  putDocument(doc: ResumeDocument): Promise<void>;
  getDocument(documentId: string): Promise<ResumeDocument | null>;
  listDocuments(): Promise<ResumeDocument[]>;
  /** Deletes the document record AND its binaries. */
  deleteDocument(documentId: string): Promise<void>;

  /** Delete everything resume-related: master, variants, documents, binaries, settings. */
  clearAll(): Promise<void>;
}

export type ImportOptions = { maxBytes: number };

/** B1 (src/resume/import/index.ts). Runs only in extension pages (options / offscreen), never in the service worker. */
export type ParseResumeFn = (file: { name: string; bytes: Uint8Array }, options?: ImportOptions) => Promise<ParsedResume>;

/** B1: turns a confirmed ParsedResume.draft into the master. Merges with provenance "resume_import_approved". Never auto-called. */
export type ConfirmImportFn = (draft: NonNullable<ParsedResume["draft"]>, now: Date) => MasterResume;

// ------------------------------------------------------------------ B2: src/resume/layout + src/resume/export

/** Injected by the caller (B3 implements it; a no-op stub in B2's tests): returns shorter replacements for the given lines. */
export type ShortenFn = (lines: TailoredLine[], target: { reduceLines: number; reason: string }) => Promise<TailoredLine[]>;

/** Lays a tailored resume out, deterministically, with the embedded font. The page count comes from the engine itself. */
export type LayoutPdfFn = (
  tailored: TailoredResume,
  config: LayoutConfig,
  deps?: { shorten?: ShortenFn },
) => Promise<{ bytes: Uint8Array; result: LayoutResult }>;

export type ValidatePdfFn = (
  bytes: Uint8Array,
  expectations: { pageLimit: number; requiredSections: string[]; contact: { name: string; email?: string; phone?: string } },
) => Promise<PdfValidation>;

/** DOCX from the same structured content. Page count is NOT validated for DOCX. */
export type ExportDocxFn = (tailored: TailoredResume, config: LayoutConfig) => Promise<Uint8Array>;

// ------------------------------------------------------------------ B3: src/resume/tailor + src/resume/variants

/**
 * The existing provider layer (Phase 4/6): providers, config and the KV store used by the router and usage log.
 * `null` means AI is off or unconfigured: tailoring then reorders and selects only, and every line keeps the master wording.
 */
export type TailorAi = { providers: AIProvider[]; config: AIConfig; store: KVStore; sleep?: RouterDeps["sleep"] } | null;

export type TailorInput = {
  master: MasterResume;
  variant: ResumeVariant;
  job: JobContext;
  match: MatchReport | null;
  profile: UserProfile;
  ai: TailorAi;
  /** Shared per-run request budget (decremented by the pipeline as it spends requests). */
  budget: { remaining: number };
  now?: () => Date;
};

export type TailorOutput = {
  tailored: TailoredResume;
  report: Omit<ResumeTailoringReport, "validation" | "output" | "docxOutput" | "coverLetter" | "layout">;
};

export type TailorFn = (input: TailorInput) => Promise<TailorOutput>;

/** Auto-selection from the job (Phase 5 match + title keywords). Returns the variant and whether the choice was automatic. */
export type SelectVariantFn = (variants: ResumeVariant[], job: JobContext, match: MatchReport | null, preferredId: string | null) => { variant: ResumeVariant; auto: boolean };

/** Provides the ShortenFn for B2's fit loop, validated by the same grounding checks (B3). */
export type MakeShortenFn = (input: { master: MasterResume; job: JobContext; ai: TailorAi; budget: { remaining: number } }) => ShortenFn;

export type CoverLetterFn = (input: { master: MasterResume; job: JobContext; ai: TailorAi; budget: { remaining: number } }) => Promise<TailoredResume | null>;

// ------------------------------------------------------------------ B4: src/content/upload

export type ClassifyFileInputFn = (field: FormField) => { classification: UploadClassification; reason: string };

/** What the content script gives the upload module: observed fields and their elements. */
export type UploadContext = { doc: Document; fields: FormField[]; elementsFor(fieldId: string): HTMLElement[] | undefined };

export type HandleUploadFn = (req: UploadContentRequest, ctx: UploadContext) => Promise<UploadContentResponse | ErrorResponse>;

/** Decides which stored file may go into which field. Pure: B4. Never puts a resume into a cover-letter or "other" field. */
export type ChooseFileForFieldFn = (
  field: { classification: UploadClassification; accept: string; hasFile: boolean },
  available: { resume: FileRef[]; coverLetter: FileRef[] },
) => { file: FileRef | null; warning: string | null; reason: string };

export type { UploadResult };
