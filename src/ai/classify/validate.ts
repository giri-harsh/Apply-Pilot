import { SENSITIVE_TYPES, type FormField, type ProfileKey, type SemanticType } from "@/shared/form";
import { matchAliases } from "@/shared/aliases";
import { TYPE_TO_PROFILE_KEY } from "@/shared/profile-keys";
import { AiMappingItemSchema } from "./schema";

export type AcceptedMapping = {
  fieldId: string;
  semanticType: SemanticType;
  profileKey: ProfileKey;
  confidence: number;
  evidence: string[];
};

export type RejectReason =
  | "malformed"
  | "unknown_field"
  | "duplicate_field"
  | "disallowed_type"
  | "key_mismatch"
  | "sensitive_label"
  | "profile_key_conflict"
  | "low_confidence"
  | "requires_review"
  | "not_mapped";

export type Rejection = { fieldId: string; reason: RejectReason };

/** Types a model may legitimately return a mapping for: those with a deterministic profile key. */
const MAPPABLE = new Set<SemanticType>(Object.keys(TYPE_TO_PROFILE_KEY) as SemanticType[]);

/**
 * Deterministic code decides what the model proposed is allowed (SPEC 24). The AI is a hint source only:
 * nothing here trusts its confidence as a probability, and sensitive types are rejected even if the model
 * returns them with full confidence.
 */
export function validateMappings(
  rawItems: unknown[],
  candidates: FormField[],
  acceptThreshold: number,
): { accepted: AcceptedMapping[]; rejected: Rejection[] } {
  const byId = new Map(candidates.map((c) => [c.fieldId, c]));
  const rejected: Rejection[] = [];
  const parsed: { item: ReturnType<typeof AiMappingItemSchema.parse>; field: FormField }[] = [];
  const seen = new Map<string, number>();

  for (const raw of rawItems) {
    const rawId = typeof raw === "object" && raw !== null && "fieldId" in raw ? String((raw as { fieldId: unknown }).fieldId).slice(0, 20) : "";
    const r = AiMappingItemSchema.safeParse(raw);
    if (!r.success) {
      rejected.push({ fieldId: rawId, reason: "malformed" });
      continue;
    }
    const field = byId.get(r.data.fieldId);
    if (!field) {
      rejected.push({ fieldId: r.data.fieldId, reason: "unknown_field" });
      continue;
    }
    seen.set(r.data.fieldId, (seen.get(r.data.fieldId) ?? 0) + 1);
    parsed.push({ item: r.data, field });
  }

  const duplicates = new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  for (const id of duplicates) rejected.push({ fieldId: id, reason: "duplicate_field" });

  const keyUse = new Map<string, string[]>();
  const stage: AcceptedMapping[] = [];
  for (const { item, field } of parsed) {
    if (duplicates.has(item.fieldId)) continue;
    const t = item.semanticType;
    if (t === "unknown") {
      rejected.push({ fieldId: item.fieldId, reason: "not_mapped" });
      continue;
    }
    // Sensitive and non-mappable types are policy rejections even when the model says "no key".
    if (SENSITIVE_TYPES.includes(t) || !MAPPABLE.has(t)) {
      rejected.push({ fieldId: item.fieldId, reason: "disallowed_type" });
      continue;
    }
    if (TYPE_TO_PROFILE_KEY[t] !== item.profileKey) {
      rejected.push({ fieldId: item.fieldId, reason: "key_mismatch" });
      continue;
    }
    // Defence in depth: even if gating missed it, a sensitive-looking label can never be accepted.
    if (field.signals.some((s) => {
      const m = matchAliases(s.text);
      return m && (SENSITIVE_TYPES.includes(m.type) || m.type === "consent");
    })) {
      rejected.push({ fieldId: item.fieldId, reason: "sensitive_label" });
      continue;
    }
    if (item.requiresReview) {
      rejected.push({ fieldId: item.fieldId, reason: "requires_review" });
      continue;
    }
    if (item.confidence < acceptThreshold) {
      rejected.push({ fieldId: item.fieldId, reason: "low_confidence" });
      continue;
    }
    keyUse.set(item.profileKey, [...(keyUse.get(item.profileKey) ?? []), item.fieldId]);
    stage.push({ fieldId: item.fieldId, semanticType: t, profileKey: item.profileKey as ProfileKey, confidence: item.confidence, evidence: item.evidence });
  }

  // Two different fields claiming the same profile key is a conflict; accept neither.
  const accepted: AcceptedMapping[] = [];
  for (const m of stage) {
    if ((keyUse.get(m.profileKey)?.length ?? 0) > 1) rejected.push({ fieldId: m.fieldId, reason: "profile_key_conflict" });
    else accepted.push(m);
  }
  return { accepted, rejected };
}
