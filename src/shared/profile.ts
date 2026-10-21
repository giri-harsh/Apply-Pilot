import { z } from "zod";

/** SPEC 6.2: every important fact must say where it came from. */
export const PROVENANCE_SOURCES = [
  "user_entered",
  "resume_import_approved",
  "approved_prior_answer",
  "verified_application",
  "derived_approved",
] as const;

export const ProvenanceSchema = z.object({
  source: z.enum(PROVENANCE_SOURCES),
  recordedAt: z.string().datetime({ message: "Must be an ISO timestamp" }),
  note: z.string().max(500).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

const str = (max = 200) => z.string().trim().max(max);
const optUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "Must be an http(s) URL or empty");
const optDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}(-\d{2})?$/.test(v), "Use YYYY-MM or YYYY-MM-DD");

const id = () => z.string().min(1).max(64);

export const PERSONAL_KEYS = [
  "fullName",
  "preferredName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "city",
  "state",
  "country",
  "postalCode",
  "address",
  "linkedinUrl",
  "githubUrl",
  "portfolioUrl",
] as const;
export type PersonalKey = (typeof PERSONAL_KEYS)[number];

export const PersonalSchema = z
  .object({
    fullName: str(),
    preferredName: str(),
    firstName: str(100),
    lastName: str(100),
    email: str(254).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Not a valid email address"),
    phone: str(40).refine((v) => v === "" || /^[+\d][\d\s().-]{5,}$/.test(v), "Not a valid phone number"),
    city: str(),
    state: str(),
    country: str(),
    postalCode: str(20),
    address: str(300),
    linkedinUrl: optUrl,
    githubUrl: optUrl,
    portfolioUrl: optUrl,
    otherLinks: z.array(optUrl).max(10),
    /** Keyed by PersonalKey. Every non-empty fact must have an entry. */
    provenance: z.record(z.string(), ProvenanceSchema),
  })
  .superRefine((p, ctx) => {
    for (const key of PERSONAL_KEYS) {
      if (p[key] !== "" && !p.provenance[key]) {
        ctx.addIssue({
          code: "custom",
          path: ["provenance", key],
          message: `Missing provenance for "${key}"`,
        });
      }
    }
  });
export type Personal = z.infer<typeof PersonalSchema>;

export const EducationSchema = z.object({
  id: id(),
  institution: str().min(1, "Institution is required"),
  degree: str(),
  fieldOfStudy: str(),
  startDate: optDate,
  expectedGraduationDate: optDate,
  graduationDate: optDate,
  grade: str(30),
  gradingScale: str(30),
  coursework: z.array(str(100)).max(50),
  distinctions: z.array(str(200)).max(20),
  provenance: ProvenanceSchema,
});
export type Education = z.infer<typeof EducationSchema>;

export const SKILL_CATEGORIES = [
  "programming_languages",
  "data_science",
  "machine_learning",
  "deep_learning",
  "nlp",
  "computer_vision",
  "generative_ai",
  "agentic_ai",
  "databases",
  "backend",
  "frontend",
  "cloud_deployment",
  "developer_tools",
  "other",
] as const;

export const SkillSchema = z.object({
  id: id(),
  name: str(100).min(1, "Skill name is required"),
  category: z.enum(SKILL_CATEGORIES),
  proficiency: z.enum(["", "beginner", "intermediate", "advanced"]),
  evidence: str(300),
  lastVerified: optDate,
  provenance: ProvenanceSchema,
});
export type Skill = z.infer<typeof SkillSchema>;

export const ProjectSchema = z.object({
  id: id(),
  name: str().min(1, "Project name is required"),
  description: str(1000),
  problem: str(1000),
  architecture: str(1000),
  technologies: z.array(str(60)).max(40),
  contribution: str(1000),
  achievements: z.array(str(300)).max(20),
  metrics: z.array(z.object({ text: str(200), source: str(200) })).max(20),
  repoUrl: optUrl,
  liveUrl: optUrl,
  startDate: optDate,
  endDate: optDate,
  concepts: z.array(str(60)).max(40),
  evidence: z.array(str(300)).max(20),
  provenance: ProvenanceSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const ExperienceSchema = z.object({
  id: id(),
  employer: str().min(1, "Employer is required"),
  position: str().min(1, "Position is required"),
  employmentType: z.enum(["", "internship", "full_time", "part_time", "contract", "research", "volunteer"]),
  startDate: optDate,
  endDate: optDate,
  /** Explicit flag; the autofill engine never infers "current employer" from a missing end date. */
  current: z.boolean(),
  responsibilities: z.array(str(500)).max(20),
  achievements: z.array(str(500)).max(20),
  technologies: z.array(str(60)).max(40),
  metrics: z.array(z.object({ text: str(200), source: str(200) })).max(20),
  evidence: z.array(str(300)).max(20),
  provenance: ProvenanceSchema,
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const CertificationSchema = z.object({
  id: id(),
  title: str().min(1, "Title is required"),
  issuer: str(),
  issueDate: optDate,
  expirationDate: optDate,
  credentialId: str(100),
  credentialUrl: optUrl,
  provenance: ProvenanceSchema,
});
export type Certification = z.infer<typeof CertificationSchema>;

export const PreferencesSchema = z.object({
  roleCategories: z.array(str(80)).max(20),
  locations: z.array(str(80)).max(20),
  workArrangement: z.enum(["", "remote", "hybrid", "onsite", "any"]),
  availabilityDate: optDate,
  employmentPreference: z.enum(["", "internship", "full_time", "either"]),
  /** Only what the user explicitly typed; never inferred (SPEC 6.2). Not auto-filled in Phase 3. */
  workAuthorization: str(300),
  willingToRelocate: z.enum(["", "yes", "no"]),
  salaryExpectation: str(100),
  noticePeriod: str(100),
  resumeTemplate: str(80),
  resumeMaxPages: z.number().int().min(1).max(5),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const PROFILE_SCHEMA_VERSION = 1;

export const UserProfileSchema = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  personal: PersonalSchema,
  education: z.array(EducationSchema).max(20),
  skills: z.array(SkillSchema).max(300),
  projects: z.array(ProjectSchema).max(50),
  experience: z.array(ExperienceSchema).max(50),
  certifications: z.array(CertificationSchema).max(50),
  preferences: PreferencesSchema,
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export function emptyProfile(): UserProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    personal: {
      fullName: "",
      preferredName: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      city: "",
      state: "",
      country: "",
      postalCode: "",
      address: "",
      linkedinUrl: "",
      githubUrl: "",
      portfolioUrl: "",
      otherLinks: [],
      provenance: {},
    },
    education: [],
    skills: [],
    projects: [],
    experience: [],
    certifications: [],
    preferences: {
      roleCategories: [],
      locations: [],
      workArrangement: "",
      availabilityDate: "",
      employmentPreference: "",
      workAuthorization: "",
      willingToRelocate: "",
      salaryExpectation: "",
      noticePeriod: "",
      resumeTemplate: "",
      resumeMaxPages: 1,
    },
  };
}

export function newId(): string {
  return crypto.randomUUID();
}

export function userProvenance(now = new Date()): Provenance {
  return { source: "user_entered", recordedAt: now.toISOString() };
}

export type ProfileIssue = { path: string; message: string };

export function validateProfile(
  input: unknown,
): { ok: true; profile: UserProfile } | { ok: false; issues: ProfileIssue[] } {
  const r = UserProfileSchema.safeParse(input);
  if (r.success) return { ok: true, profile: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}
