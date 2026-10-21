import { z } from "zod";
import { UserProfileSchema } from "./profile";
import { AgentActionSchema, FormFieldSchema, FieldResultSchema, PROFILE_KEYS, SEMANTIC_TYPES } from "./form";
import { PROVIDER_IDS } from "../ai/config";
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
export const ProviderIdSchema = z.enum(PROVIDER_IDS);

export const BackgroundRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("START_RUN"), tabId: z.number().int() }),
  z.object({ kind: z.literal("STOP_RUN"), tabId: z.number().int() }),
  z.object({ kind: z.literal("GET_RUN"), tabId: z.number().int() }),
  z.object({ kind: z.literal("AI_GET_STATUS") }),
  z.object({
    kind: z.literal("AI_SET_SETTINGS"),
    aiEnabled: z.boolean(),
    providerOrder: z.array(ProviderIdSchema).min(1).max(2),
  }),
  // The only message that carries a secret, and only inbound to the service worker.
  z.object({ kind: z.literal("AI_SET_KEY"), provider: ProviderIdSchema, secret: z.string().min(1).max(400) }),
  z.object({ kind: z.literal("AI_CLEAR_KEY"), provider: ProviderIdSchema }),
  z.object({ kind: z.literal("AI_TEST_CONNECTION"), provider: ProviderIdSchema }),
  z.object({ kind: z.literal("AI_CLEAR_CACHE") }),
]);
export type BackgroundRequest = z.infer<typeof BackgroundRequestSchema>;

export const AiStatusSchema = z.object({
  aiEnabled: z.boolean(),
  mode: z.enum(["off", "not_configured", "ready"]),
  providerOrder: z.array(ProviderIdSchema),
  keys: z.record(ProviderIdSchema, z.object({ configured: z.boolean(), hint: z.string().max(12) })),
  models: z.record(ProviderIdSchema, z.string()),
  usage: z.object({ requests: z.number().int(), lastOutcome: z.string().nullable() }),
  cacheEntries: z.number().int(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const BackgroundResponseSchema = z.union([
  z.object({ ok: z.literal(true), run: RunRecordSchema.nullable() }),
  z.object({ ok: z.literal(true), kind: z.literal("ai_status"), status: AiStatusSchema }),
  z.object({
    ok: z.literal(true),
    kind: z.literal("ai_test"),
    result: z.object({ success: z.boolean(), provider: ProviderIdSchema, outcome: z.string().max(40), latencyMs: z.number().int().nullable() }),
  }),
  z.object({ ok: z.literal(true), kind: z.literal("ack") }),
  z.object({ ok: z.literal(false), kind: z.literal("rejected"), message: z.string().max(200) }),
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
  aiMapped: z.boolean().optional(),
  confidence: z.object({ identification: z.number().min(0).max(1), mapping: z.number().min(0).max(1) }).optional(),
});
export type PlannedFill = z.infer<typeof PlannedFillSchema>;

export const AiMappingInputSchema = z.object({
  fieldId: z.string(),
  semanticType: z.enum(SEMANTIC_TYPES),
  profileKey: z.enum(PROFILE_KEYS),
  confidence: z.number().min(0).max(1),
});

export const ContentRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PING") }),
  z.object({ kind: z.literal("OBSERVE") }),
  z.object({ kind: z.literal("MAP"), profile: UserProfileSchema }),
  z.object({ kind: z.literal("MAP_AI"), profile: UserProfileSchema, mappings: z.array(AiMappingInputSchema).max(100) }),
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
  requestSchema: z.ZodType<Req, z.ZodTypeDef, unknown>,
  responseSchema: z.ZodType<Res, z.ZodTypeDef, unknown>,
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
  requestSchema: z.ZodType<Req, z.ZodTypeDef, unknown>,
  responseSchema: z.ZodType<Res, z.ZodTypeDef, unknown>,
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
