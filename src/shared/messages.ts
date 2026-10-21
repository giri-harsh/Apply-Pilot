import { z } from "zod";
import { UserProfileSchema } from "./profile";
import { AgentActionSchema, FormFieldSchema, FieldResultSchema } from "./form";
import { RunRecordSchema } from "./run";

export const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  code: z.enum([
    "INVALID_MESSAGE",
    "UNTRUSTED_SENDER",
    "DUPLICATE_RUN",
    "NO_RUN",
    "NO_PROFILE",
    "INJECTION_FAILED",
    "CANCELLED",
    "INTERNAL",
  ]),
  message: z.string().max(500),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---- popup / options -> service worker ----
export const BackgroundRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("START_RUN"), tabId: z.number().int() }),
  z.object({ kind: z.literal("STOP_RUN"), tabId: z.number().int() }),
  z.object({ kind: z.literal("GET_RUN"), tabId: z.number().int() }),
]);
export type BackgroundRequest = z.infer<typeof BackgroundRequestSchema>;

export const BackgroundResponseSchema = z.union([
  z.object({ ok: z.literal(true), run: RunRecordSchema.nullable() }),
  ErrorResponseSchema,
]);
export type BackgroundResponse = z.infer<typeof BackgroundResponseSchema>;

// ---- service worker -> content script ----
export const PlannedFillSchema = z.object({
  fieldId: z.string(),
  action: AgentActionSchema,
  semanticType: FieldResultSchema.shape.semanticType,
  label: z.string(),
  required: z.boolean(),
});
export type PlannedFill = z.infer<typeof PlannedFillSchema>;

export const ContentRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PING") }),
  z.object({ kind: z.literal("OBSERVE") }),
  z.object({ kind: z.literal("MAP"), profile: UserProfileSchema }),
  z.object({ kind: z.literal("EXECUTE"), plan: z.array(PlannedFillSchema).max(500) }),
  z.object({ kind: z.literal("VERIFY"), plan: z.array(PlannedFillSchema).max(500) }),
  z.object({ kind: z.literal("CANCEL") }),
]);
export type ContentRequest = z.infer<typeof ContentRequestSchema>;

export const ExecutionResultSchema = z.object({
  fieldId: z.string(),
  executed: z.boolean(),
  error: z.string().max(300).nullable(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const VerificationResultSchema = z.object({
  fieldId: z.string(),
  verified: z.boolean(),
  reason: z.string().max(300),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const ContentResponseSchema = z.union([
  z.object({ ok: z.literal(true), kind: z.literal("PONG") }),
  z.object({
    ok: z.literal(true),
    kind: z.literal("OBSERVED"),
    url: z.string(),
    pageTitle: z.string(),
    fields: z.array(FormFieldSchema),
  }),
  z.object({
    ok: z.literal(true),
    kind: z.literal("MAPPED"),
    plan: z.array(PlannedFillSchema),
    skipped: z.array(FieldResultSchema),
  }),
  z.object({ ok: z.literal(true), kind: z.literal("EXECUTED"), results: z.array(ExecutionResultSchema) }),
  z.object({ ok: z.literal(true), kind: z.literal("VERIFIED"), results: z.array(VerificationResultSchema) }),
  z.object({ ok: z.literal(true), kind: z.literal("CANCELLED") }),
  ErrorResponseSchema,
]);
export type ContentResponse = z.infer<typeof ContentResponseSchema>;

/** Validate an inbound message, run the handler, and validate its response before it leaves. */
export async function handleValidated<Req, Res>(
  raw: unknown,
  requestSchema: z.ZodType<Req>,
  responseSchema: z.ZodType<Res>,
  handler: (req: Req) => Promise<Res>,
): Promise<Res | ErrorResponse> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_MESSAGE", message: "Message failed schema validation" };
  }
  try {
    const res = await handler(parsed.data);
    const out = responseSchema.safeParse(res);
    if (!out.success) return { ok: false, code: "INTERNAL", message: "Response failed schema validation" };
    return out.data;
  } catch (e) {
    return { ok: false, code: "INTERNAL", message: safeMessage(e) };
  }
}

/** Validate an outbound message, send it, and validate the reply. Throws on a malformed reply. */
export async function sendValidated<Req, Res>(
  send: (msg: Req) => Promise<unknown>,
  requestSchema: z.ZodType<Req>,
  responseSchema: z.ZodType<Res>,
  message: Req,
): Promise<Res> {
  const req = requestSchema.parse(message);
  const raw = await send(req);
  const res = responseSchema.safeParse(raw);
  if (!res.success) throw new Error("Received a malformed reply");
  return res.data;
}

export function safeMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 300);
}
