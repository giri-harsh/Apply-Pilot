import { z } from "zod";
import { FileRefSchema, LayoutConfigSchema, LayoutResultSchema, PdfValidationSchema, TailoredLineSchema, TailoredResumeSchema } from "./schema";

/**
 * Messages between the service worker and the offscreen document that does the heavy PDF work (layout, validation with
 * pdfjs, DOCX). They carry structured resume content only, never API keys: all AI calls stay in the service worker, which
 * the offscreen document reaches through RESUME_SHORTEN when the fit loop wants shorter wording.
 *
 * Every offscreen request is tagged `target: "offscreen"`; the service worker's own listener ignores those, and the
 * offscreen document ignores everything else.
 */

export const OffscreenRequestSchema = z.object({
  target: z.literal("offscreen"),
  kind: z.literal("BUILD"),
  /** Identifies the service worker's tailoring session so a shorten callback can find its context. */
  sessionId: z.string().min(8).max(64),
  tailored: TailoredResumeSchema,
  config: LayoutConfigSchema,
  documentKind: z.enum(["Resume", "CoverLetter"]),
  filename: z.string().min(1).max(200),
  docxFilename: z.string().min(1).max(200).nullable(),
  contact: z.object({ name: z.string().max(200), email: z.string().max(254).optional(), phone: z.string().max(60).optional() }),
});
export type OffscreenRequest = z.infer<typeof OffscreenRequestSchema>;

export const OffscreenResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    layout: LayoutResultSchema,
    validation: PdfValidationSchema,
    pdf: FileRefSchema,
    docx: FileRefSchema.nullable(),
  }),
  z.object({ ok: z.literal(false), message: z.string().max(300) }),
]);
export type OffscreenResponse = z.infer<typeof OffscreenResponseSchema>;

/** Offscreen -> service worker: ask for shorter replacements (validated by the same grounding checks). */
export const ShortenRequestSchema = z.object({
  kind: z.literal("RESUME_SHORTEN"),
  sessionId: z.string().min(8).max(64),
  lines: z.array(TailoredLineSchema).min(1).max(60),
  target: z.object({ reduceLines: z.number().int().min(1).max(40), reason: z.string().max(200) }),
});
export type ShortenRequest = z.infer<typeof ShortenRequestSchema>;
export const ShortenResponseSchema = z.object({ ok: z.literal(true), lines: z.array(TailoredLineSchema).max(60) });
