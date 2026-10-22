import { z } from "zod";
import { LengthLimitSchema } from "../answers/limits";

export const SEMANTIC_TYPES = [
  "full_name",
  "first_name",
  "last_name",
  "preferred_name",
  "email",
  "phone",
  "city",
  "state",
  "country",
  "postal_code",
  "address_line",
  "linkedin",
  "github",
  "portfolio",
  "institution",
  "degree",
  "field_of_study",
  "graduation_year",
  "gpa",
  "current_employer",
  "current_title",
  "availability_date",
  "notice_period",
  // sensitive / eligibility: recognised so they can be flagged, never auto-answered
  "work_authorization",
  "sponsorship",
  "disability",
  "veteran_status",
  "race_ethnicity",
  "gender",
  "criminal_history",
  "salary",
  "date_of_birth",
  "age",
  "relocation",
  "government_id",
  // other kinds
  "consent",
  "open_ended",
  "third_party_contact",
  "resume_upload",
  "cover_letter_upload",
  "other_upload",
  "unknown",
] as const;
export type SemanticType = (typeof SEMANTIC_TYPES)[number];

export const SENSITIVE_TYPES: readonly SemanticType[] = [
  "work_authorization",
  "sponsorship",
  "disability",
  "veteran_status",
  "race_ethnicity",
  "gender",
  "criminal_history",
  "salary",
  "date_of_birth",
  "age",
  "relocation",
  "government_id",
];

export const PROFILE_KEYS = [
  "personal.fullName",
  "personal.firstName",
  "personal.lastName",
  "personal.preferredName",
  "personal.email",
  "personal.phone",
  "personal.city",
  "personal.state",
  "personal.country",
  "personal.postalCode",
  "personal.address",
  "personal.linkedinUrl",
  "personal.githubUrl",
  "personal.portfolioUrl",
  "education.institution",
  "education.degree",
  "education.fieldOfStudy",
  "education.graduationYear",
  "education.grade",
  "experience.currentEmployer",
  "experience.currentTitle",
  "preferences.availabilityDate",
  "preferences.noticePeriod",
] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export const LABEL_SOURCES = [
  "explicit_label",
  "aria_labelledby",
  "aria_label",
  "name_or_id",
  "placeholder",
  "nearby_text",
  "section_heading",
  "legend",
  "none",
] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

export const ControlKind = z.enum(["text", "textarea", "select", "radio", "checkbox", "file", "combobox"]);
export type ControlKind = z.infer<typeof ControlKind>;

export const Risk = z.enum(["low", "moderate", "high", "restricted"]);
export type Risk = z.infer<typeof Risk>;

export const FieldOptionSchema = z.object({ value: z.string(), label: z.string() });

/** SPEC 9.2 field representation, extended with the evidence the mapper needs. */
export const FormFieldSchema = z.object({
  fieldId: z.string().regex(/^field_\d{3,}$/),
  tagName: z.string(),
  inputType: z.string(),
  control: ControlKind,
  label: z.string(),
  labelSource: z.enum(LABEL_SOURCES),
  signals: z.array(z.object({ source: z.enum(LABEL_SOURCES), text: z.string() })),
  name: z.string(),
  elementId: z.string(),
  autocomplete: z.string(),
  placeholder: z.string().nullable(),
  ariaLabel: z.string().nullable(),
  required: z.boolean(),
  visible: z.boolean(),
  enabled: z.boolean(),
  options: z.array(FieldOptionSchema),
  currentValue: z.string(),
  sectionContext: z.string(),
  semanticCandidates: z.array(z.enum(SEMANTIC_TYPES)),
  semanticType: z.enum(SEMANTIC_TYPES),
  confidence: z.number().min(0).max(1),
  ambiguous: z.boolean(),
  ambiguityReason: z.string().nullable(),
  risk: Risk,
  /** Page-observation fingerprint used to confirm the target is still the same field. */
  fingerprint: z.string(),
  /** Custom widgets (combobox / autocomplete) need selection support, not typing. */
  widget: z.enum(["native", "combobox"]).default("native"),
  /** Length limit detected from maxlength, nearby text or a live counter (SPEC 14.2). */
  limit: LengthLimitSchema.nullable().default(null),
  /** Id of the portal adapter whose hint decided this field's type (evidence only; the risk policy still applied). */
  adapterHint: z.string().max(40).optional(),
  /** `accept` attribute of a file input ("" for everything else). Phase 7 uploads respect it. */
  accept: z.string().max(300).default(""),
  /** The field holds a value but the page currently shows a validation error for it (so "already correct" is not true). */
  invalid: z.boolean().default(false),
  /** Set only when an accepted AI mapping decided the semantic type (SPEC 9.5). */
  aiMapped: z.boolean().optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

/** SPEC 11.5 action union. Extend only when a real use case needs it. */
export const AgentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fill_text"), fieldId: z.string(), value: z.string().max(5000) }),
  z.object({ type: z.literal("select_option"), fieldId: z.string(), optionValue: z.string().max(500) }),
  z.object({ type: z.literal("set_checkbox"), fieldId: z.string(), checked: z.boolean() }),
  z.object({ type: z.literal("select_radio"), fieldId: z.string(), optionValue: z.string().max(500) }),
  // Custom widgets (SPEC 12.3 / 12.4): open, observe the real options, pick by label, then verify.
  z.object({ type: z.literal("select_custom_option"), fieldId: z.string(), optionLabel: z.string().max(300) }),
  z.object({ type: z.literal("fill_autocomplete"), fieldId: z.string(), query: z.string().max(300), optionLabel: z.string().max(300) }),
  z.object({ type: z.literal("upload_file"), fieldId: z.string(), fileReference: z.string() }),
  z.object({ type: z.literal("inspect_again") }),
  z.object({ type: z.literal("navigate_next") }),
  z.object({ type: z.literal("pause_for_user"), reason: z.string().max(500) }),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

/** Action types the Phase 3 executor is willing to run. */
export const EXECUTABLE_ACTIONS = ["fill_text", "select_option", "select_radio", "set_checkbox", "select_custom_option", "fill_autocomplete"] as const;

export const FieldOutcome = z.enum([
  "filled_verified",
  "filled_unverified",
  "failed",
  "skipped_sensitive",
  "skipped_consent",
  "skipped_third_party",
  "ambiguous",
  "unresolved",
  "already_correct",
]);
export type FieldOutcome = z.infer<typeof FieldOutcome>;

export const FieldResultSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  outcome: FieldOutcome,
  required: z.boolean(),
  reason: z.string(),
  /** Never contains the entered value. */
  semanticType: z.enum(SEMANTIC_TYPES),
  aiMapped: z.boolean().optional(),
  /** An answer written by the model from profile evidence; always needs the user's review (SPEC 14). */
  aiWritten: z.boolean().optional(),
  /** Merge key within a step, and whether the action ran (a failed outcome may still have executed). */
  fingerprint: z.string().max(300).optional(),
  executed: z.boolean().optional(),
  step: z.number().int().nonnegative().optional(),
  /** Names of the evidence items behind a written answer (e.g. "Project: Sales Forecaster"). */
  evidence: z.array(z.string().max(200)).max(10).optional(),
  /** SPEC 17.1: separate dimensions, never collapsed into one unexplained score. */
  confidence: z
    .object({
      identification: z.number().min(0).max(1),
      mapping: z.number().min(0).max(1),
      profileEvidence: z.number().min(0).max(1),
      execution: z.number().min(0).max(1).nullable(),
      verification: z.number().min(0).max(1).nullable(),
    })
    .optional(),
});
export type FieldResult = z.infer<typeof FieldResultSchema>;

/** One page/step of a multi-step application with its real counts (SPEC 18.4). */
export const StepSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  url: z.string().max(300),
  title: z.string().max(200),
  totalFields: z.number().int().nonnegative(),
  filled: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skippedSensitive: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  alreadyCorrect: z.number().int().nonnegative(),
  requiredUnresolved: z.number().int().nonnegative(),
  /** The control that moved the run to the next step, or null on the last step reached. */
  advancedBy: z.string().max(100).nullable(),
  outcome: z.enum(["advanced", "stopped", "final", "blocked"]),
  note: z.string().max(300).nullable(),
});
export type StepSummary = z.infer<typeof StepSummarySchema>;

export const CompletionReportSchema = z.object({
  totalFields: z.number().int().nonnegative(),
  filled: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skippedSensitive: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  alreadyCorrect: z.number().int().nonnegative(),
  requiredUnresolved: z.number().int().nonnegative(),
  aiMapped: z.number().int().nonnegative().default(0),
  aiWritten: z.number().int().nonnegative().default(0),
  /** Per-step breakdown (a single-page form has one step). */
  steps: z.array(StepSummarySchema).default([]),
  /** Honest notes: blockers, unreadable frames, limits reached. Never empty when something could not be done. */
  notes: z.array(z.string().max(300)).max(20).default([]),
  results: z.array(FieldResultSchema),
});
export type CompletionReport = z.infer<typeof CompletionReportSchema>;
