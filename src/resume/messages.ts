import { z } from "zod";
import { UploadClassificationSchema, UploadResultSchema } from "./schema";

/**
 * Phase 7 messages between the service worker and the content script (file upload). Bytes only ever travel as base64
 * chunks over the extension message channel; there is no URL the page could fetch, and a transfer is bound to one field.
 */

/** 192 KiB of raw bytes per chunk (about 256 KiB of base64), well under the message size limit. */
export const UPLOAD_CHUNK_BYTES = 196_608;
export const UPLOAD_MAX_CHUNKS = 128;

export const UploadFieldInfoSchema = z.object({
  fieldId: z.string(),
  classification: UploadClassificationSchema,
  accept: z.string().max(300),
  label: z.string().max(200),
  required: z.boolean(),
  /** Why it was classified this way (shown in the report). */
  reason: z.string().max(200),
  /** The input already holds a file (never replaced). */
  hasFile: z.boolean(),
});
export type UploadFieldInfo = z.infer<typeof UploadFieldInfoSchema>;

export const UploadContentRequestSchemas = [
  z.object({ kind: z.literal("UPLOAD_LIST") }),
  z.object({
    kind: z.literal("UPLOAD_BEGIN"),
    transferId: z.string().min(8).max(64),
    fieldId: z.string(),
    filename: z.string().min(1).max(200),
    mime: z.string().max(120),
    size: z.number().int().min(1).max(20_000_000),
    chunkCount: z.number().int().min(1).max(UPLOAD_MAX_CHUNKS),
  }),
  z.object({ kind: z.literal("UPLOAD_CHUNK"), transferId: z.string().min(8).max(64), index: z.number().int().min(0).max(UPLOAD_MAX_CHUNKS), dataB64: z.string().max(300_000) }),
  z.object({ kind: z.literal("UPLOAD_COMMIT"), transferId: z.string().min(8).max(64) }),
  z.object({ kind: z.literal("UPLOAD_ABORT"), transferId: z.string().min(8).max(64) }),
] as const;

export const UploadContentResponseSchemas = [
  z.object({ ok: z.literal(true), kind: z.literal("UPLOAD_FIELDS"), fields: z.array(UploadFieldInfoSchema).max(20) }),
  z.object({ ok: z.literal(true), kind: z.literal("UPLOAD_ACK"), transferId: z.string(), received: z.number().int() }),
  z.object({ ok: z.literal(true), kind: z.literal("UPLOADED"), result: UploadResultSchema }),
] as const;

/** Tailoring request / progress / result (SW <-> options or popup). Types for the LEAD's wiring; no secrets inside. */
export const TailorRequestSchema = z.object({
  tabId: z.number().int(),
  /** Per-run override; null = auto-select from the job match. */
  variantId: z.string().max(80).nullable(),
});
export const TailorProgressSchema = z.object({
  stage: z.enum(["selecting_variant", "ranking", "rewriting", "grounding", "laying_out", "validating", "saving", "done", "failed"]),
  detail: z.string().max(200),
});
export type TailorRequest = z.infer<typeof TailorRequestSchema>;
export type TailorProgress = z.infer<typeof TailorProgressSchema>;

export type UploadContentRequest = z.infer<(typeof UploadContentRequestSchemas)[number]>;
export type UploadContentResponse = z.infer<(typeof UploadContentResponseSchemas)[number]>;
