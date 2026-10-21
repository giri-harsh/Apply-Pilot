import { z } from "zod";
import { PROFILE_KEYS, SEMANTIC_TYPES } from "@/shared/form";
import type { JsonSchema } from "../types";

/** SPEC 24 contract. `none` means "no profile key"; there is no nullable so every provider can express it. */
export const AI_PROFILE_KEYS = [...PROFILE_KEYS, "none"] as const;

export const AiMappingItemSchema = z.object({
  fieldId: z.string().regex(/^field_\d{3,}$/),
  semanticType: z.enum(SEMANTIC_TYPES),
  profileKey: z.enum(AI_PROFILE_KEYS),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().max(160)).max(3),
  requiresReview: z.boolean(),
});
export type AiMappingItem = z.infer<typeof AiMappingItemSchema>;

/**
 * Provider-level validation only checks the envelope. Each item is then validated one by one by
 * `validateMappings`, so one malformed or malicious item cannot discard the good ones.
 */
export const AiEnvelopeSchema = z.object({ mappings: z.array(z.unknown()).max(100) });
export type AiEnvelope = z.infer<typeof AiEnvelopeSchema>;

export const AI_CLASSIFICATION_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          fieldId: { type: "string", maxLength: 20 },
          semanticType: { type: "string", enum: [...SEMANTIC_TYPES] },
          profileKey: { type: "string", enum: [...AI_PROFILE_KEYS] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "array", maxItems: 3, items: { type: "string", maxLength: 160 } },
          requiresReview: { type: "boolean" },
        },
        required: ["fieldId", "semanticType", "profileKey", "confidence", "evidence", "requiresReview"],
        additionalProperties: false,
      },
    },
  },
  required: ["mappings"],
  additionalProperties: false,
};

export const ConnectionTestSchema = z.object({ ok: z.boolean() });
export const CONNECTION_TEST_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
