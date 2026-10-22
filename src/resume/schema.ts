import { z } from "zod";
import { ProvenanceSchema } from "@/shared/profile";

/**
 * Phase 7 data contracts (SPEC 7, 23). LEAD-owned: builders read these and request changes in
 * docs/agents/CONTRACT_REQUESTS.md instead of editing them.
 *
 * The central rule: a master resume is a set of FACTS, each with a stable `factId` and provenance. Variants select and
 * order factIds; tailored output lines cite the factIds they came from. Nothing in a tailored resume exists without a
 * source fact, and nothing here ever mutates the master.
 */

const text = (max: number) => z.string().trim().max(max);
const id = () => z.string().min(1).max(80);

// ------------------------------------------------------------------ master resume

export const SECTION_KEYS = ["summary", "education", "experience", "projects", "skills", "certifications", "achievements"] as const;
export const SectionKeySchema = z.enum(SECTION_KEYS);
export type SectionKey = z.infer<typeof SectionKeySchema>;

/** One verified statement. `text` is the user's approved wording and is the only text a tailored line may restate. */
export const FactSchema = z.object({
  factId: id(),
  text: text(600),
  provenance: ProvenanceSchema,
  /** Verbatim text from the imported file this fact was parsed from (kept so the user can compare). */
  sourceText: text(1200).optional(),
  /** Import flagged this fact (uncertain section, odd ordering). The confirm UI shows these first. */
  lowConfidence: z.boolean().default(false),
});
export type Fact = z.infer<typeof FactSchema>;

/** An education / experience / project / certification record. Its heading line and bullets are all facts. */
export const MasterEntrySchema = z.object({
  entryId: id(),
  section: SectionKeySchema,
  heading: FactSchema, // e.g. "Acme Labs — Data Intern" or "Sales Forecaster"
  subheading: FactSchema.optional(), // e.g. degree, role line
  dates: text(80).default(""),
  location: text(120).default(""),
  bullets: z.array(FactSchema).max(30),
  technologies: z.array(text(60)).max(40).default([]),
  links: z.array(z.object({ label: text(60), url: text(500), factId: id() })).max(6).default([]),
  /** The Profile Vault record this entry mirrors, when there is one. */
  profileRecordId: id().optional(),
});
export type MasterEntry = z.infer<typeof MasterEntrySchema>;

export const SkillGroupSchema = z.object({
  groupId: id(),
  label: text(80), // "Languages", "Machine learning"
  items: z.array(FactSchema).max(60), // one fact per skill, text = the skill name
});
export type SkillGroup = z.infer<typeof SkillGroupSchema>;

export const MasterContactSchema = z.object({
  name: FactSchema,
  email: FactSchema.optional(),
  phone: FactSchema.optional(),
  location: FactSchema.optional(),
  links: z.array(z.object({ label: text(60), url: text(500), fact: FactSchema })).max(8).default([]),
});

export const MASTER_SCHEMA_VERSION = 1;

export const MasterResumeSchema = z.object({
  schemaVersion: z.literal(MASTER_SCHEMA_VERSION),
  masterId: id(),
  contact: MasterContactSchema,
  summary: FactSchema.optional(),
  entries: z.array(MasterEntrySchema).max(120),
  skillGroups: z.array(SkillGroupSchema).max(20),
  achievements: z.array(FactSchema).max(30).default([]),
  /** Where it came from and when the user confirmed it. A master only exists after an explicit confirmation. */
  confirmedAt: z.string().datetime(),
  importedFrom: z.object({ filename: text(200), format: z.enum(["pdf", "docx", "txt", "md", "profile"]), importedAt: z.string().datetime() }).optional(),
});
export type MasterResume = z.infer<typeof MasterResumeSchema>;

// ------------------------------------------------------------------ import

export const ParsedSectionSchema = z.object({
  key: SectionKeySchema.or(z.literal("contact")).or(z.literal("unknown")),
  heading: text(120),
  /** 0..1. Below 0.6 the confirm UI marks the section as uncertain. */
  confidence: z.number().min(0).max(1),
  sourceText: z.string().max(20000),
});
export type ParsedSection = z.infer<typeof ParsedSectionSchema>;

export const ParsedResumeSchema = z.object({
  filename: text(200),
  format: z.enum(["pdf", "docx", "txt", "md"]),
  hasExtractableText: z.boolean(),
  sourceText: z.string().max(200000),
  sections: z.array(ParsedSectionSchema).max(40),
  /** A master DRAFT in the same shape as the real thing; it becomes the master only on explicit confirmation. */
  draft: MasterResumeSchema.omit({ confirmedAt: true }).nullable(),
  warnings: z.array(text(300)).max(30),
});
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

// ------------------------------------------------------------------ variants (rules over factIds, never copies)

export const ResumeVariantSchema = z.object({
  variantId: id(),
  name: text(80), // "AI/ML Engineer"
  roleKeywords: z.array(text(60)).max(30), // matched against the job title for auto-selection
  sectionOrder: z.array(SectionKeySchema).max(7),
  /** Entries to show, in order. Missing entries may still be added by space-permitting rule 8 of SPEC 7.4. */
  entryOrder: z.array(id()).max(120),
  pinnedFactIds: z.array(id()).max(200),
  excludedFactIds: z.array(id()).max(200),
  skillGroupOrder: z.array(id()).max(20),
  limits: z.object({ maxProjects: z.number().int().min(0).max(20), maxExperience: z.number().int().min(0).max(20), maxBulletsPerEntry: z.number().int().min(1).max(12) }),
});
export type ResumeVariant = z.infer<typeof ResumeVariantSchema>;

// ------------------------------------------------------------------ tailored output

export const LINE_ROLES = ["name", "contact", "section_title", "entry_heading", "entry_subheading", "entry_meta", "bullet", "skills_row", "paragraph"] as const;

export const TailoredLineSchema = z.object({
  lineId: id(),
  role: z.enum(LINE_ROLES),
  text: text(800),
  url: text(500).optional(),
  /** Every line cites the master facts it restates. A line with no source fact is invalid. */
  sourceFactIds: z.array(id()).min(1).max(8),
  /** "master" = the user's own wording, unchanged. "rewritten" = new wording that passed grounding. */
  origin: z.enum(["master", "rewritten"]),
  /** For a rewritten line: the master wording it replaced. */
  masterText: text(800).optional(),
  /** 0..1 relevance to the job, used by the fit loop to decide what to drop first. */
  relevance: z.number().min(0).max(1).default(0.5),
  /** Never dropped by the fit loop (contact, section titles, most relevant education, sole evidence for a required qualification). */
  protected: z.boolean().default(false),
  onlyEvidenceForRequiredQualification: z.boolean().default(false),
});
export type TailoredLine = z.infer<typeof TailoredLineSchema>;

export const TailoredEntrySchema = z.object({ entryId: id(), lines: z.array(TailoredLineSchema).min(1).max(40) });
export const TailoredSectionSchema = z.object({ key: SectionKeySchema.or(z.literal("header")), title: text(80), entries: z.array(TailoredEntrySchema).max(60) });

export const TailoredResumeSchema = z.object({
  tailoredId: id(),
  masterId: id(),
  masterHash: z.string().length(64),
  variantId: id(),
  sections: z.array(TailoredSectionSchema).min(1).max(10),
  createdAt: z.string().datetime(),
});
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;
export type TailoredSection = z.infer<typeof TailoredSectionSchema>;

// ------------------------------------------------------------------ layout

/** Hard readability floors (SPEC 7.5). A config below any of them is rejected, so the fit loop cannot cheat. */
export const LAYOUT_FLOORS = { bodyPt: 10, marginIn: 0.5, lineHeight: 1.1 } as const;

export const LayoutConfigSchema = z
  .object({
    fontFamily: z.enum(["embedded-sans"]).default("embedded-sans"),
    pageSize: z.enum(["letter", "a4"]).default("letter"),
    bodyPt: z.number().min(LAYOUT_FLOORS.bodyPt).max(14).default(10.5),
    headingPt: z.number().min(10).max(18).default(12),
    namePt: z.number().min(14).max(30).default(20),
    marginIn: z.number().min(LAYOUT_FLOORS.marginIn).max(1.5).default(0.7),
    lineHeight: z.number().min(LAYOUT_FLOORS.lineHeight).max(1.6).default(1.2),
    sectionGapPt: z.number().min(2).max(24).default(10),
    entryGapPt: z.number().min(1).max(16).default(5),
    bulletIndentPt: z.number().min(6).max(30).default(14),
    sectionOrder: z.array(SectionKeySchema).max(7).default(["summary", "education", "experience", "projects", "skills", "certifications", "achievements"]),
    pageLimit: z.number().int().min(1).max(5).default(1),
  })
  .strict();
export type LayoutConfig = z.infer<typeof LayoutConfigSchema>;
export const DEFAULT_LAYOUT: LayoutConfig = LayoutConfigSchema.parse({});

export const LayoutResultSchema = z.object({
  pageCount: z.number().int().min(1),
  /** The tailored resume as finally laid out (fit-loop shortening / dropping applied). */
  finalResume: TailoredResumeSchema,
  appliedConfig: LayoutConfigSchema,
  droppedLineIds: z.array(id()),
  shortenedLineIds: z.array(id()),
  satisfiedLimit: z.boolean(),
  warnings: z.array(text(300)).max(30),
});
export type LayoutResult = z.infer<typeof LayoutResultSchema>;

export const PdfValidationSchema = z.object({
  ok: z.boolean(),
  pageCount: z.number().int().min(0),
  pageLimit: z.number().int(),
  missingSections: z.array(text(80)),
  missingContact: z.array(text(40)),
  findings: z.array(text(300)).max(40),
});
export type PdfValidation = z.infer<typeof PdfValidationSchema>;

// ------------------------------------------------------------------ files, history, report

export const FileRefSchema = z.object({
  fileId: id(),
  filename: text(200),
  mime: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]),
  size: z.number().int().nonnegative(),
  format: z.enum(["pdf", "docx", "txt"]),
  /** True only for a PDF whose page count was read back from the rendered bytes. */
  pageValidated: z.boolean(),
  createdAt: z.string().datetime(),
});
export type FileRef = z.infer<typeof FileRefSchema>;

export const ResumeTailoringReportSchema = z.object({
  reportId: id(),
  createdAt: z.string().datetime(),
  masterId: id(),
  masterHash: z.string().length(64),
  variantId: id(),
  variantAutoSelected: z.boolean(),
  job: z.object({ title: text(200), company: text(200), url: text(500) }),
  /** Job requirements (canonical skill names) that the profile evidences / does not. */
  matchedRequirements: z.array(text(80)).max(60),
  unmatchedRequirements: z.array(text(80)).max(60),
  selectedFactIds: z.array(id()).max(600),
  modifiedSections: z.array(SectionKeySchema),
  rewrites: z
    .array(
      z.object({
        lineId: id(),
        status: z.enum(["accepted", "fallback_to_master", "kept_master"]),
        violations: z.array(text(200)).max(10),
      }),
    )
    .max(200),
  droppedLines: z.array(z.object({ lineId: id(), reason: text(200) })).max(200),
  layout: z.object({ pageCount: z.number().int(), pageLimit: z.number().int(), satisfiedLimit: z.boolean(), warnings: z.array(text(300)).max(30) }),
  validation: PdfValidationSchema.nullable(),
  warnings: z.array(text(300)).max(40),
  output: FileRefSchema.nullable(),
  docxOutput: FileRefSchema.nullable(),
  ai: z.object({ requests: z.number().int().nonnegative(), provider: z.string().nullable() }),
});
export type ResumeTailoringReport = z.infer<typeof ResumeTailoringReportSchema>;

/** One saved application resume (SPEC 7.7). The job snapshot is the approved extract, never the full page. */
export const ResumeDocumentSchema = z.object({
  documentId: id(),
  createdAt: z.string().datetime(),
  masterId: id(),
  masterHash: z.string().length(64),
  variantId: id(),
  job: z.object({ title: text(200), company: text(200), url: text(500), extract: text(6000) }),
  tailored: TailoredResumeSchema,
  report: ResumeTailoringReportSchema,
  validationStatus: z.enum(["validated", "overflow", "unvalidated", "failed"]),
});
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;

// ------------------------------------------------------------------ uploads

export const UploadClassificationSchema = z.enum(["resume", "cover_letter", "other", "ambiguous"]);
export type UploadClassification = z.infer<typeof UploadClassificationSchema>;

export const UploadResultSchema = z.object({
  fieldId: z.string(),
  status: z.enum(["uploaded_verified", "uploaded_unrecognized", "skipped", "failed"]),
  classification: UploadClassificationSchema,
  reason: text(300),
  fileId: id().nullable(),
  filename: text(200).nullable(),
  warnings: z.array(text(300)).max(10),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

// ------------------------------------------------------------------ settings

export const RESUME_SETTINGS_KEY = "applypilot.resume.settings.v1";
export const ResumeSettingsSchema = z.object({
  /** Off until the user has confirmed a master resume and turns it on. */
  tailoringEnabled: z.boolean().default(false),
  pageLimit: z.number().int().min(1).max(5).default(1),
  coverLetterEnabled: z.boolean().default(false),
  maxUploadBytes: z.number().int().min(100_000).max(20_000_000).default(5_000_000),
  autoSelectVariant: z.boolean().default(true),
  defaultVariantId: id().nullable().default(null),
  layout: LayoutConfigSchema.partial().default({}),
});
export type ResumeSettings = z.infer<typeof ResumeSettingsSchema>;
export const DEFAULT_RESUME_SETTINGS: ResumeSettings = ResumeSettingsSchema.parse({});
