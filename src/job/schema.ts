import { z } from "zod";

/** Where a piece of job information came from, strongest first. */
export const JOB_SOURCES = ["json_ld", "microdata", "heading", "page_selector", "document_title", "open_graph", "main_content", "text_pattern", "url_slug"] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

const list = (max = 30, len = 300) => z.array(z.string().max(len)).max(max);

/**
 * SPEC 8.2. Missing scalar values are `null` ("unknown"), never invented; missing lists are empty.
 */
export const JobContextSchema = z.object({
  jobTitle: z.string().max(200).nullable(),
  company: z.string().max(200).nullable(),
  jobUrl: z.string().max(2000),
  descriptionText: z.string().max(60_000),
  requiredQualifications: list(),
  preferredQualifications: list(),
  responsibilities: list(),
  requiredSkills: list(40, 60),
  preferredSkills: list(40, 60),
  educationRequirements: list(8),
  experienceRequirements: list(8),
  location: z.string().max(200).nullable(),
  employmentType: z.enum(["internship", "full_time", "part_time", "contract", "temporary", "other"]).nullable(),
  workArrangement: z.enum(["remote", "hybrid", "onsite"]).nullable(),
  relevantKeywords: list(60, 60),
  /** Eligibility language found in the posting (visa, clearance, citizenship...). For the user to review; never auto-answered. */
  eligibilityNotes: list(8),
  sourceConfidence: z.number().min(0).max(1),
  sources: z.object({
    title: z.enum(JOB_SOURCES).nullable(),
    company: z.enum(JOB_SOURCES).nullable(),
    description: z.enum(JOB_SOURCES).nullable(),
  }),
  extractionWarnings: list(20, 200),
  /** Skills added by the optional, off-by-default AI enrichment. Each must appear in the description text. */
  aiEnrichedSkills: list(20, 60).default([]),
});
export type JobContext = z.infer<typeof JobContextSchema>;

export const MatchComponentSchema = z.object({
  component: z.string(),
  weight: z.number(),
  value: z.number().min(0).max(1).nullable(),
  note: z.string().max(300),
});

export const RankedItemSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  score: z.number().min(0).max(1),
  evidence: z.array(z.string().max(200)).max(20),
});

/** SPEC 8.3: transparent relevance, a decision aid and not a hiring prediction. */
export const MatchReportSchema = z.object({
  overall: z.number().min(0).max(100).nullable(),
  components: z.array(MatchComponentSchema),
  matchedRequiredSkills: z.array(z.string()),
  missingRequiredSkills: z.array(z.string()),
  matchedPreferredSkills: z.array(z.string()),
  projects: z.array(RankedItemSchema),
  experience: z.array(RankedItemSchema),
  education: z.object({ status: z.enum(["compatible", "unknown", "mismatch"]), evidence: z.array(z.string().max(200)) }),
  eligibilityFlags: z.array(z.string().max(300)),
  disclaimer: z.string(),
});
export type MatchReport = z.infer<typeof MatchReportSchema>;

/** The compact summary stored on a run and shown in the popup. */
export const JobSummarySchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(200)).max(20),
  skills: z.array(z.string().max(60)).max(40),
  descriptionChars: z.number().int().nonnegative(),
  fromCache: z.boolean(),
  matchScore: z.number().min(0).max(100).nullable(),
  topProjects: z.array(z.string().max(200)).max(3),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export function summarizeJob(job: JobContext, match: MatchReport | null, fromCache: boolean): JobSummary {
  return {
    title: job.jobTitle,
    company: job.company,
    confidence: job.sourceConfidence,
    warnings: job.extractionWarnings.slice(0, 20),
    skills: [...new Set([...job.requiredSkills, ...job.preferredSkills])].slice(0, 40),
    descriptionChars: job.descriptionText.length,
    fromCache,
    matchScore: match?.overall ?? null,
    topProjects: (match?.projects ?? []).slice(0, 3).map((p) => p.name),
  };
}
