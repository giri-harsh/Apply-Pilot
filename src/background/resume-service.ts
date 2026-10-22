import { rankAgainstProfile } from "@/job/rank";
import type { JobContext, MatchReport } from "@/job/schema";
import type { ChooseFileForFieldFn, CoverLetterFn, MakeShortenFn, SelectVariantFn, ShortenFn, TailorAi, TailorFn } from "@/resume/contracts";
import { assertMasterUnchanged, hashMaster } from "@/resume/hash";
import { resumeFilename } from "@/resume/filename";
import type { OffscreenRequest, OffscreenResponse } from "@/resume/offscreen-protocol";
import {
  DEFAULT_LAYOUT,
  LayoutConfigSchema,
  ResumeDocumentSchema,
  type FileRef,
  type MasterResume,
  type ResumeDocument,
  type ResumeVariant,
  type TailoredLine,
  type UploadResult,
} from "@/resume/schema";
import type { ResumeStore } from "@/resume/contracts";
import type { UploadFieldInfo } from "@/resume/messages";
import type { ContentRequest, ContentResponse } from "@/shared/messages";
import type { FieldResult, FormField } from "@/shared/form";
import type { UserProfile } from "@/shared/profile";
import type { RunRecord } from "@/shared/run";
import type { UploadPhaseInput, UploadPhaseResult } from "./run-manager";
import { transferFile } from "./upload-client";

/**
 * Orchestrates resume handling for a run (SPEC 7.4, 16): choose a variant, tailor (or reuse a validated file), have the
 * offscreen document lay it out and validate it, save it, and upload it to the page's file field. The service worker owns
 * every AI call; the offscreen document only gets structured content and asks back for shorter wording through `shorten`.
 */

export type ResumeServiceDeps = {
  store: ResumeStore;
  loadProfile(): Promise<UserProfile | null>;
  /** The Phase 5 job context for this page (cached extraction), or null. */
  loadJob(url: string): Promise<JobContext | null>;
  getAi(): Promise<TailorAi>;
  tailor: TailorFn;
  selectVariant: SelectVariantFn;
  defaultVariants(master: MasterResume): ResumeVariant[];
  makeShorten: MakeShortenFn;
  coverLetter: CoverLetterFn;
  build(req: OffscreenRequest): Promise<OffscreenResponse>;
  chooseFile: ChooseFileForFieldFn;
  sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse>;
  now(): Date;
  newId(): string;
  /** Model requests one tailoring may spend (rewrite, one regeneration, one shorten). */
  aiRequests?: number;
};

type Prepared = {
  status: RunRecord["resume"]["status"];
  pdf: FileRef | null;
  docx: FileRef | null;
  variantId: string | null;
  variantAuto: boolean;
  documentId: string | null;
  pageCount: number | null;
  warnings: string[];
};

/** Generated documents kept in the history (each is a few KB of structured text plus two files in IndexedDB). */
export const MAX_DOCUMENTS = 30;

const none = (status: Prepared["status"], warning: string): Prepared => ({ status, pdf: null, docx: null, variantId: null, variantAuto: false, documentId: null, pageCount: null, warnings: [warning] });

export class ResumeService {
  private sessions = new Map<string, ShortenFn>();
  private prepared = new Map<string, Promise<Prepared>>();
  private coverCache = new Map<string, Promise<{ file: FileRef | null; reason: string }>>();

  constructor(private deps: ResumeServiceDeps) {}

  /** Offscreen -> worker: shorter wording for the fit loop. Unknown session or any problem returns the lines unchanged. */
  async shorten(sessionId: string, lines: TailoredLine[], target: { reduceLines: number; reason: string }): Promise<TailoredLine[]> {
    const fn = this.sessions.get(sessionId);
    if (!fn) return lines;
    try {
      return await fn(lines, target);
    } catch {
      return lines;
    }
  }

  /** The file to use for this run, made once per run and shared by every file field and step. */
  prepare(runId: string, url: string, variantOverride: string | null, existing: RunRecord["resume"]): Promise<Prepared> {
    let p = this.prepared.get(runId);
    if (!p) {
      p = this.resumeExisting(existing)
        .then((again) => again ?? this.doPrepare(url, variantOverride))
        .catch((e) => none("failed", `Resume preparation failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`));
      this.prepared.set(runId, p);
      while (this.prepared.size > 5) this.prepared.delete(this.prepared.keys().next().value!);
    }
    return p;
  }

  /**
   * After a service worker restart or a continuation run the document made earlier in this run is used again (its id is on
   * the run record) instead of tailoring a second time, which would spend the AI budget and create another document.
   */
  private async resumeExisting(existing: RunRecord["resume"]): Promise<Prepared | null> {
    if (!existing.documentId || (existing.status !== "tailored" && existing.status !== "reused")) return null;
    const doc = await this.deps.store.getDocument(existing.documentId);
    const pdf = doc?.report.output ?? null;
    if (!doc || !pdf || !(await this.deps.store.getBinary(pdf.fileId))) return null;
    const docx = doc.report.docxOutput && (await this.deps.store.getBinary(doc.report.docxOutput.fileId)) ? doc.report.docxOutput : null;
    if (doc.validationStatus === "failed") return null;
    return { status: existing.status, pdf, docx, variantId: doc.variantId, variantAuto: existing.variantAuto, documentId: doc.documentId, pageCount: doc.report.layout.pageCount, warnings: existing.warnings };
  }

  private async lastValidatedFor(variantId: string | null): Promise<{ doc: ResumeDocument; pdf: FileRef; docx: FileRef | null } | null> {
    const docs = (await this.deps.store.listDocuments()).filter((d) => d.validationStatus === "validated" && d.report.output && (variantId === null || d.variantId === variantId));
    docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const doc of docs) {
      const pdf = doc.report.output!;
      if (await this.deps.store.getBinary(pdf.fileId)) return { doc, pdf, docx: doc.report.docxOutput };
    }
    return null;
  }

  private async doPrepare(url: string, variantOverride: string | null): Promise<Prepared> {
    const d = this.deps;
    const settings = await d.store.getSettings();
    const master = await d.store.getMaster();
    if (!master) return none("none", "No master resume is saved. Import and confirm one in Settings > Resume.");

    const stored = await d.store.listVariants();
    const variants = stored.length > 0 ? stored : d.defaultVariants(master);
    if (variants.length === 0) return none("none", "No resume variant is available.");
    const job = await d.loadJob(url);
    const profile = await d.loadProfile();
    const match: MatchReport | null = job && profile ? rankAgainstProfile(job, profile) : null;
    const preferred = variantOverride ?? settings.defaultVariantId;
    let variant: ResumeVariant;
    let auto: boolean;
    if (job) {
      const sel = d.selectVariant(variants, job, match, preferred);
      variant = sel.variant;
      auto = sel.auto;
    } else {
      variant = variants.find((v) => v.variantId === preferred) ?? variants[0]!;
      auto = false;
    }

    const reuse = async (why: string): Promise<Prepared> => {
      const last = await this.lastValidatedFor(variant.variantId);
      if (!last) return { ...none(settings.tailoringEnabled ? "none" : "off", `${why} No previously validated resume exists for the "${variant.name}" variant.`), variantId: variant.variantId, variantAuto: auto };
      return { status: "reused", pdf: last.pdf, docx: last.docx, variantId: variant.variantId, variantAuto: auto, documentId: last.doc.documentId, pageCount: last.doc.report.layout.pageCount, warnings: [`${why} Reusing the last validated resume for "${variant.name}".`] };
    };

    if (!settings.tailoringEnabled) return reuse("Resume tailoring is off.");
    if (!job || !profile) return reuse(!job ? "No job description could be read from this page." : "No profile is saved.");

    const masterHash = await hashMaster(master);
    const ai = await d.getAi();
    const budget = { remaining: ai ? (d.aiRequests ?? 3) : 0 };
    const out = await d.tailor({ master, variant, job, match, profile, ai, budget, now: () => d.now() });

    const sessionId = d.newId();
    this.sessions.set(sessionId, d.makeShorten({ master, job, ai, budget }));
    try {
      const taken = new Set((await d.store.listBinaries()).map((f) => f.filename));
      const filename = resumeFilename({ company: job.company ?? "", role: job.jobTitle ?? "", date: d.now(), taken });
      const config = LayoutConfigSchema.parse({ ...DEFAULT_LAYOUT, ...settings.layout, pageLimit: settings.pageLimit });
      const built = await d.build({
        target: "offscreen",
        kind: "BUILD",
        sessionId,
        tailored: out.tailored,
        config,
        documentKind: "Resume",
        filename,
        docxFilename: filename.replace(/\.pdf$/, ".docx"),
        contact: { name: master.contact.name.text, email: master.contact.email?.text, phone: master.contact.phone?.text },
      });
      if (!built.ok) return reuse(`The resume could not be built (${built.message}).`);

      // Binaries are written by the offscreen document before this record exists: any failure from here on removes them.
      const dropBinaries = async () => {
        for (const f of [built.pdf, built.docx]) if (f) await d.store.deleteBinary(f.fileId).catch(() => undefined);
      };
      try {
        // The master must be exactly what it was when tailoring started.
        const after = await d.store.getMaster();
        if (!after) throw new Error("The master resume disappeared during tailoring");
        await assertMasterUnchanged(after, masterHash);
      } catch (e) {
        await dropBinaries();
        throw e;
      }

      const warnings = [...out.report.warnings, ...built.layout.warnings];
      if (!built.layout.satisfiedLimit) warnings.push(`The ${settings.pageLimit}-page limit could not be met cleanly (${built.layout.pageCount} page(s)). Review the resume before submitting.`);
      if (!built.validation.ok) warnings.push(...built.validation.findings.slice(0, 5));
      const status: ResumeDocument["validationStatus"] = !built.validation.ok ? "failed" : built.layout.satisfiedLimit ? "validated" : "overflow";
      const jobInfo = { title: job.jobTitle ?? "", company: job.company ?? "", url: job.jobUrl.slice(0, 500) };
      const doc: ResumeDocument = ResumeDocumentSchema.parse({
        documentId: d.newId(),
        createdAt: d.now().toISOString(),
        masterId: master.masterId,
        masterHash,
        variantId: variant.variantId,
        job: { ...jobInfo, extract: job.descriptionText.slice(0, 6000) },
        tailored: built.layout.finalResume,
        report: {
          ...out.report,
          // Variant exclusions (from the tailoring report) plus every line the page-fit rule dropped.
          droppedLines: [...out.report.droppedLines, ...built.layout.droppedLineIds.map((lineId) => ({ lineId, reason: "Dropped by the page-fit rule (lowest relevance first)" }))].slice(0, 200),
          layout: { pageCount: built.layout.pageCount, pageLimit: settings.pageLimit, satisfiedLimit: built.layout.satisfiedLimit, warnings: built.layout.warnings },
          validation: built.validation,
          warnings,
          output: built.pdf,
          docxOutput: built.docx,
          coverLetter: null,
          variantAutoSelected: auto,
        },
        validationStatus: status,
      });
      try {
        await d.store.putDocument(doc);
      } catch (e) {
        await dropBinaries();
        throw e;
      }
      // Keep the history bounded: the oldest documents and their files go first (documents are stored in chrome.storage.local).
      const all = (await d.store.listDocuments()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const old of all.slice(0, Math.max(0, all.length - MAX_DOCUMENTS))) await d.store.deleteDocument(old.documentId).catch(() => undefined);
      // A resume that failed validation (for example the applicant's name could not be drawn) is kept in the history for
      // inspection but is never sent to an employer: fall back to the last validated one, or nothing.
      if (status === "failed") return reuse(`The generated resume failed validation (${built.validation.findings[0] ?? "see the history"}), so it was not uploaded.`);
      return { status: "tailored", pdf: built.pdf, docx: built.docx, variantId: variant.variantId, variantAuto: auto, documentId: doc.documentId, pageCount: built.layout.pageCount, warnings };
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * A cover letter for a required cover-letter field (default OFF). Written from the same facts and held to the same
   * grounding rules as the resume; never invented without AI. Made once per run and attached to the run's resume document so
   * that deleting the document deletes the letter too.
   */
  private coverLetterFor(input: UploadPhaseInput, prepared: Prepared): Promise<{ file: FileRef | null; reason: string }> {
    const key = `${input.runId}:cover`;
    let p = this.coverCache.get(key);
    if (!p) {
      p = this.makeCoverLetter(input, prepared).catch((e) => ({ file: null, reason: `The cover letter could not be made (${e instanceof Error ? e.message.slice(0, 120) : "error"}); left for you` }));
      this.coverCache.set(key, p);
    }
    return p;
  }

  private async makeCoverLetter(input: UploadPhaseInput, prepared: Prepared): Promise<{ file: FileRef | null; reason: string }> {
    const d = this.deps;
    const master = await d.store.getMaster();
    const job = await d.loadJob(input.url);
    const doc = prepared.documentId ? await d.store.getDocument(prepared.documentId) : null;
    if (!master || !job || !doc) return { file: null, reason: "A cover letter needs your master resume, the job description and a resume document; left for you" };
    if (doc.report.coverLetter && (await d.store.getBinary(doc.report.coverLetter.fileId))) return { file: doc.report.coverLetter, reason: "" };
    const ai = await d.getAi();
    if (!ai) return { file: null, reason: "A cover letter needs AI, which is off or not configured; left for you" };
    const letter = await d.coverLetter({ master, job, ai, budget: { remaining: d.aiRequests ?? 3 } });
    if (!letter) return { file: null, reason: "No grounded cover letter could be written; left for you" };

    // The letter body is one section; the header (name and contact, from the master's own facts) is added here.
    const c = master.contact;
    const contactParts = [c.email, c.phone, c.location].filter((f): f is NonNullable<typeof f> => !!f);
    const header = {
      key: "header" as const,
      title: "",
      entries: [
        {
          entryId: "cl_header",
          lines: [
            { lineId: "cl_name", role: "name" as const, text: c.name.text, sourceFactIds: [c.name.factId], origin: "master" as const, relevance: 1, protected: true, onlyEvidenceForRequiredQualification: false },
            ...(contactParts.length > 0
              ? [{ lineId: "cl_contact", role: "contact" as const, text: contactParts.map((f) => f.text).join(" | "), sourceFactIds: contactParts.map((f) => f.factId), origin: "master" as const, relevance: 1, protected: true, onlyEvidenceForRequiredQualification: false }]
              : []),
          ],
        },
      ],
    };
    const sessionId = d.newId();
    const taken = new Set((await d.store.listBinaries()).map((f) => f.filename));
    const filename = resumeFilename({ company: job.company ?? "", role: job.jobTitle ?? "", kind: "CoverLetter", date: d.now(), taken });
    const settings = await d.store.getSettings();
    const config = LayoutConfigSchema.parse({ ...DEFAULT_LAYOUT, ...settings.layout, pageLimit: 1 });
    const built = await d.build({
      target: "offscreen", kind: "BUILD", sessionId, tailored: { ...letter, sections: [header, ...letter.sections] }, config, documentKind: "CoverLetter", filename, docxFilename: null,
      contact: { name: c.name.text, email: c.email?.text, phone: c.phone?.text },
    });
    if (!built.ok) return { file: null, reason: `The cover letter could not be built (${built.message}); left for you` };
    if (!built.validation.ok || !built.layout.satisfiedLimit) {
      await d.store.deleteBinary(built.pdf.fileId).catch(() => undefined);
      return { file: null, reason: "The generated cover letter did not validate as one clean page; left for you" };
    }
    await d.store.putDocument({ ...doc, report: { ...doc.report, coverLetter: built.pdf } });
    return { file: built.pdf, reason: "" };
  }

  /** The RunManager hook: put the right file into each file field, verify, and report honestly. */
  async uploadResume(input: UploadPhaseInput): Promise<UploadPhaseResult> {
    const d = this.deps;
    const results: FieldResult[] = [];
    const notes: string[] = [];
    let resume = { ...input.resume, uploaded: [...input.resume.uploaded] };

    const list = await d.sendToTab(input.tabId, { kind: "UPLOAD_LIST" });
    if (!list.ok || list.kind !== "UPLOAD_FIELDS") {
      notes.push("The page's file fields could not be read, so no resume was uploaded; upload it yourself.");
      return { results, resume, notes };
    }
    const infoById = new Map(list.fields.map((f) => [f.fieldId, f]));

    const row = (f: FormField, outcome: FieldResult["outcome"], reason: string, executed = false): FieldResult => ({
      fieldId: f.fieldId, label: f.label, outcome, required: f.required, reason: reason.slice(0, 280), semanticType: f.semanticType, fingerprint: f.fingerprint, executed,
    });

    let prepared: Prepared | null = null;
    for (const f of input.fields) {
      const info: UploadFieldInfo | undefined = infoById.get(f.fieldId);
      if (!info) {
        results.push(row(f, "unresolved", "This file field could not be inspected"));
        continue;
      }
      if (resume.uploaded.includes(f.fingerprint)) {
        results.push(row(f, "already_correct", "Already uploaded in this run"));
        continue;
      }
      if (info.hasFile) {
        // A file ApplyPilot did not add (it is not in this run's uploads) is not proof that the right resume is attached.
        results.push(row(f, "unresolved", "The field already holds a file that ApplyPilot did not add; it was not replaced. Check that it is the right resume."));
        continue;
      }
      if (info.classification === "ambiguous" || info.classification === "other") {
        results.push(row(f, info.classification === "ambiguous" ? "ambiguous" : "unresolved", `Not a resume field (${info.reason}); left for you`));
        continue;
      }
      const isLetter = info.classification === "cover_letter";
      if (isLetter) {
        // Optional by default: only a REQUIRED cover-letter field, with the setting on, gets a generated letter.
        const settings = await d.store.getSettings();
        if (!settings.coverLetterEnabled || !f.required) {
          results.push(row(f, "unresolved", !settings.coverLetterEnabled ? "Cover letter field; cover letters are off, left for you" : "Optional cover letter field; left for you"));
          continue;
        }
      }

      prepared ??= await this.prepare(input.runId, input.url, input.variantId, input.resume);
      resume = { ...resume, status: prepared.status, variantId: prepared.variantId, variantAuto: prepared.variantAuto, documentId: prepared.documentId, filename: prepared.pdf?.filename ?? null, pageCount: prepared.pageCount, warnings: prepared.warnings.slice(0, 10) };
      await input.save(resume); // the document id is on the run record before any byte is sent, so a restart reuses it
      let letter: FileRef | null = null;
      if (isLetter) {
        const made = await this.coverLetterFor(input, prepared);
        if (!made.file) {
          results.push(row(f, "unresolved", made.reason));
          continue;
        }
        letter = made.file;
      } else if (!prepared.pdf) {
        results.push(row(f, "unresolved", prepared.warnings[0] ?? "No resume file is available"));
        continue;
      }
      const choice = d.chooseFile(
        { classification: info.classification, accept: info.accept, hasFile: info.hasFile },
        { resume: isLetter ? [] : [prepared.pdf!, ...(prepared.docx ? [prepared.docx] : [])], coverLetter: letter ? [letter] : [] },
      );
      if (!choice.file) {
        results.push(row(f, "unresolved", choice.reason));
        continue;
      }
      if (choice.warning) resume.warnings = [...resume.warnings, choice.warning].slice(0, 10);
      const bin = await d.store.getBinary(choice.file.fileId);
      if (!bin) {
        results.push(row(f, "failed", "The saved resume file is missing from local storage"));
        continue;
      }
      const res: UploadResult = await transferFile({ send: (r) => d.sendToTab(input.tabId, r), fieldId: f.fieldId, file: bin, isActive: input.isActive, newId: () => d.newId() });
      resume.uploaded = [...resume.uploaded, f.fingerprint].slice(-10); // one attempt per field per run, whatever the outcome
      resume.warnings = [...resume.warnings, ...res.warnings].slice(0, 10);
      if (res.status === "uploaded_verified") resume.uploadVerified = true;
      await input.save(resume);
      if (res.status === "uploaded_verified") results.push(row(f, "filled_verified", res.reason || "The page recognized the upload", true));
      else if (res.status === "uploaded_unrecognized") results.push(row(f, "failed", res.reason || "Upload not recognized by the page", true));
      else if (res.status === "skipped") results.push(row(f, res.classification === "ambiguous" ? "ambiguous" : "unresolved", res.reason));
      else results.push(row(f, "failed", res.reason));
    }
    if (prepared) for (const w of prepared.warnings) if (!notes.includes(w)) notes.push(w);
    return { results, resume, notes };
  }
}
